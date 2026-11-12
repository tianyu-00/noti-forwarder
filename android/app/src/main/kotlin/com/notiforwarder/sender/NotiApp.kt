package com.notiforwarder.sender

import android.app.Application
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.provider.Telephony

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
        MessageSender(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() })
    }
    val heartbeat by lazy {
        HeartbeatSender(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() })
    }
    // The phone's open connection to the server: it shows as connected on the dashboard, and a
    // revoke made there arrives here at once. Reconnects by itself after a drop.
    private val streamClient by lazy {
        // While connected it also checks in every 25 s: only the phone can prove it is still alive.
        DeviceStreamClient(store, appVersion = BuildConfig.VERSION_NAME, beat = { heartbeat.send() })
    }
    val deviceStream: DeviceStreamRunner by lazy {
        DeviceStreamRunner(
            connect = streamClient::run,
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
            flow = PairingFlow(store, PairingClient()),
            device = DeviceInfo(
                name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                model = Build.MODEL,
                appVersion = BuildConfig.VERSION_NAME,
                // Per app and signing key; survives reinstalling, resets on a factory reset.
                hardwareId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID),
            ),
            // Messages queued while unpaired (or revoked) go out as soon as pairing works.
            onPaired = {
                scheduler.flushSoon()
                deviceStream.start()
            },
            // No point keeping a "running" notice on screen for a phone that is not paired.
            onUnpaired = {
                stopService(Intent(this, KeepAliveService::class.java))
                deviceStream.stop()
            },
            // Best effort: the dashboard shows this phone as unpaired at once instead of slowly "quiet".
            unpairOnServer = { UnpairClient().unpair(it) },
        )
    }

    override fun onCreate() {
        super.onCreate()
        scheduler.flushSoon() // an app start sends anything left in the queue
        if (store.load() != null) deviceStream.start() // reconnect after a restart of the app
        // The moment Android has a network again, reconnect instead of waiting out a retry timer.
        NetworkWatcher(this) { deviceStream.wake() }.start()
        HeartbeatWorker.schedule(this) // checks in every ~15 minutes while the phone has a network
    }
}
