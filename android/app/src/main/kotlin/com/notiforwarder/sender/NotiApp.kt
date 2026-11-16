package com.notiforwarder.sender

import android.app.Application
import java.io.File
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors

/** Wires the pure classes together once per process. */
class NotiApp : Application() {
    val store: TokenStore by lazy { EncryptedTokenStore(this) }
    val settingsStore: SettingsStore by lazy { PrefsSettingsStore(this) }
    val themeStore: ThemeStore by lazy { PrefsThemeStore(this) }
    val parser by lazy { NotificationParser(ownPackage = packageName) }
    private val database by lazy { AppDatabase.open(this) }
    val queue by lazy { MessageQueue(database.queueDao()) }
    val sendStatus: SendStatus by lazy { PrefsSendStatus(this) }
    val scheduler: FlushScheduler by lazy { WorkManagerFlushScheduler(this) }

    // The service runs without a screen, so a revocation must reach the UI state from here.
    private val sender by lazy {
        MessageSender(
            store,
            appVersion = BuildConfig.VERSION_NAME,
            onRevoked = { controller.refresh() },
            appLabel = PackageLabels(packageManager)::labelFor,
        )
    }
    val heartbeat by lazy {
        // Each check-in carries the battery level, so the dashboard and the receiver can show it.
        val batteryReader = AndroidBatteryReader(this)
        HeartbeatSender(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() }, battery = batteryReader::read)
    }
    val simLookup by lazy { SimLookup(this) }

    /** Whether this phone sends or receives. Null on a new install, until the user chooses. */
    val roleStore: RoleStore by lazy { PrefsRoleStore(this) }
    val role: AppRole? get() = effectiveRole(roleStore.load(), paired = store.load() != null)

    // --- Receiver: the main phone that shows alerts ---
    val receivedStore by lazy { RoomReceivedStore(database.receivedDao()) }
    val receiverSettingsStore: ReceiverSettingsStore by lazy { PrefsReceiverSettingsStore(this) }
    private val syncState by lazy { PrefsSyncState(this) }
    private val alertSink: AlertSink by lazy { AndroidAlertSink(this) }

    // One thread for everything the receiver does with its messages, so events and syncs never overlap.
    private val receiverThread = Executors.newSingleThreadExecutor { r -> Thread(r, "receiver").apply { isDaemon = true } }
    val receiverClient by lazy { ReceiverClient(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() }) }
    private val receiverEngine by lazy {
        ReceiverEngine(
            api = receiverClient,
            store = receivedStore,
            alerts = alertSink,
            settings = receiverSettingsStore::load,
            reader = MessageReader { store.load()?.e2eKey },
            state = syncState,
        )
    }
    private val receiverStreamClient by lazy {
        DeviceStreamClient(
            store, appVersion = BuildConfig.VERSION_NAME, beat = { heartbeat.send() },
            path = "/api/v1/receiver/stream",
            onEvent = { type, data -> receiverThread.execute { runCatching { receiverEngine.onEvent(type, data) } } },
        )
    }
    val receiverStream: DeviceStreamRunner by lazy {
        DeviceStreamRunner(
            // Each time it connects, bring the list in line with the dashboard, so nothing missed while away is lost.
            connect = { onConnected -> receiverStreamClient.run { onConnected(); receiverThread.execute { runCatching { receiverEngine.sync() } } } },
            store = store,
            onRevoked = { controller.refresh() },
            cancel = receiverStreamClient::cancel,
        )
    }

    /** Opens the receiver's connection to the server. Safe to call again: a running connection is left alone. */
    fun startReceiver() = receiverStream.start()

    /** Closes it and forgets everything received, when the phone is unpaired or changes role. */
    fun stopReceiver() {
        receiverStream.stop()
        syncState.reset()
        receiverThread.execute {
            runCatching {
                receivedStore.delete(receivedStore.allIds())
                alertSink.cancelAll()
            }
        }
    }

    // In-app updates: look at this project's GitHub releases, download the APK and hand it to Android.
    val updater by lazy {
        Updater(
            source = GitHubReleaseSource(PROJECT_REPO),
            downloader = ApkDownloader(File(cacheDir, "updates")),
            installer = AndroidApkInstaller(this),
            installedVersion = BuildConfig.VERSION_NAME,
        )
    }

    // Replies typed on the dashboard. One thread, so two triggers (an announcement and a reconnect)
    // never send the same reply at once; the processor also guards against it.
    private val replyProcessor by lazy {
        ReplyProcessor(
            outbox = OutboxClient(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() }),
            sms = AndroidSmsSender(this),
            ledger = PrefsReplyLedger(this),
            settings = settingsStore::load,
            canSendSms = {
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.SEND_SMS) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
            },
            e2eKey = { store.load()?.e2eKey },
            sims = simLookup::activeSims,
        )
    }
    private val replyThread = Executors.newSingleThreadExecutor { r -> Thread(r, "replies").apply { isDaemon = true } }

    // Tells the server which SIMs this phone has and allows, so the dashboard can offer them.
    private val simReporter by lazy {
        SimReporter(
            SimsClient(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() }),
            installed = simLookup::activeSims,
            allowed = { settingsStore.load().allowedSims },
            replies = {
                val s = settingsStore.load()
                ReportedReplies(
                    on = s.allowReplies,
                    permission = ContextCompat.checkSelfPermission(this, android.Manifest.permission.SEND_SMS) ==
                        android.content.pm.PackageManager.PERMISSION_GRANTED,
                    practice = s.practiceReplies,
                )
            },
        )
    }

    /** Sends the SIM list if it changed (or [force], for a fresh pairing). Returns at once. */
    fun reportSims(force: Boolean = false) {
        replyThread.execute { runCatching { simReporter.report(force) } }
    }

    /**
     * The server is reachable right now (the app started, or the live connection just opened): send what
     * is waiting at once, even if it was told to wait 15 minutes after earlier failures. Returns at once.
     */
    fun sendWaiting() {
        replyThread.execute {
            runCatching { queue.retryNow() }
            scheduler.flushNow()
        }
    }

    /** Looks for replies waiting on the server and sends them. Returns at once. */
    fun sendReplies() {
        replyThread.execute { runCatching { replyProcessor.process() } }
    }

    // The phone's open connection to the server: it shows as connected on the dashboard, and a
    // revoke made there arrives here at once. Reconnects by itself after a drop.
    private val streamClient by lazy {
        // While connected it also checks in every 25 s: only the phone can prove it is still alive.
        DeviceStreamClient(
            store, appVersion = BuildConfig.VERSION_NAME, beat = { heartbeat.send() }, onOutbox = ::sendReplies,
        )
    }
    val deviceStream: DeviceStreamRunner by lazy {
        DeviceStreamRunner(
            // Each time it connects, collect replies that were queued while the phone was away.
            connect = { onConnected -> streamClient.run { onConnected(); sendWaiting(); sendReplies(); reportSims() } },
            store = store,
            onRevoked = { controller.refresh() },
            cancel = streamClient::cancel,
        )
    }
    val flushRunner by lazy { FlushRunner(Flusher(queue, sender, sendStatus)::flush, scheduler) }
    val statusReader by lazy { StatusReader(queue, sendStatus) }

    private val smsDedupe = SmsDeduplicator()

    val capture by lazy {
        NotificationCapture(
            parser = parser,
            queue = queue,
            scheduler = scheduler,
            settings = settingsStore::load,
            dedupe = smsDedupe,
            // The default SMS app can change, so ask each time.
            smsPackages = { Telephony.Sms.getDefaultSmsPackage(this)?.let(::setOf).orEmpty() },
        )
    }
    val smsCapture by lazy {
        SmsCapture(
            SmsParser(), queue, scheduler, settings = settingsStore::load, dedupe = smsDedupe,
            smsPackages = { Telephony.Sms.getDefaultSmsPackage(this)?.let(::setOf).orEmpty() },
        )
    }

    val controller: PairingController by lazy {
        PairingController(
            store = store,
            flow = PairingFlow(store, PairingClient(), expectedRole = { roleStore.load() ?: AppRole.Sender }),
            device = DeviceInfo(
                name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                model = Build.MODEL,
                appVersion = BuildConfig.VERSION_NAME,
                // Per app and signing key; survives reinstalling, resets on a factory reset.
                hardwareId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID),
            ),
            // Messages queued while unpaired (or revoked) go out as soon as pairing works.
            onPaired = {
                if (roleStore.load() == AppRole.Receiver) {
                    startReceiver()
                } else {
                    scheduler.flushSoon()
                    deviceStream.start()
                    reportSims(force = true) // a new pairing: the server has not seen this phone's SIMs
                }
            },
            // No point keeping a "running" notice on screen for a phone that is not paired.
            onUnpaired = {
                stopService(Intent(this, KeepAliveService::class.java))
                deviceStream.stop()
                stopService(Intent(this, ReceiverService::class.java))
                stopReceiver()
            },
            // Best effort: the dashboard shows this phone as unpaired at once instead of slowly "quiet".
            unpairOnServer = { UnpairClient().unpair(it) },
        )
    }

    override fun onCreate() {
        super.onCreate()
        if (role != AppRole.Receiver) sendWaiting() // an app start sends anything left in the queue, without waiting out an old retry timer
        // A sender reconnects after a restart of the app; a receiver does the same through its own connection.
        if (store.load() != null) if (role == AppRole.Receiver) startReceiver() else deviceStream.start()
        // The moment Android has a network again, reconnect instead of waiting out a retry timer.
        NetworkWatcher(this) {
            deviceStream.wake()
            receiverStream.wake()
        }.start()
        HeartbeatWorker.schedule(this) // checks in every ~15 minutes while the phone has a network
    }
}
