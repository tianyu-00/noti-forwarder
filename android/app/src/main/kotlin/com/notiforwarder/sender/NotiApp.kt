package com.notiforwarder.sender

import android.app.Application
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Wires the pure classes together once per process. */
class NotiApp : Application() {
    val store: TokenStore by lazy { EncryptedTokenStore(this) }
    val settingsStore: SettingsStore by lazy { PrefsSettingsStore(this) }
    val parser by lazy { NotificationParser(ownPackage = packageName) }
    private val database by lazy { AppDatabase.open(this) }
    val queue by lazy { MessageQueue(database.queueDao()) }
    val sendStatus: SendStatus by lazy { PrefsSendStatus(this) }
    val scheduler: FlushScheduler by lazy { WorkManagerFlushScheduler(this) }

    // The service runs without a screen, so a revocation must reach the UI state from here.
    private val sender by lazy {
        MessageSender(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() })
    }
    val flushRunner by lazy { FlushRunner(Flusher(queue, sender, sendStatus)::flush, scheduler) }
    val statusReader by lazy { StatusReader(queue, sendStatus) }

    private val smsDedupe = SmsDeduplicator()
    private val holdExecutor by lazy { Executors.newSingleThreadScheduledExecutor() }

    val capture by lazy {
        NotificationCapture(
            parser = parser,
            queue = queue,
            scheduler = scheduler,
            settings = settingsStore::load,
            dedupe = smsDedupe,
            // The default SMS app can change, so ask each time.
            smsPackages = { Telephony.Sms.getDefaultSmsPackage(this)?.let(::setOf).orEmpty() },
            delayer = { delayMillis, block -> holdExecutor.schedule(block, delayMillis, TimeUnit.MILLISECONDS) },
        )
    }
    val smsCapture by lazy {
        SmsCapture(SmsParser(), queue, scheduler, settings = settingsStore::load, dedupe = smsDedupe)
    }

    val controller by lazy {
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
            onPaired = { scheduler.flushSoon() },
        )
    }

    override fun onCreate() {
        super.onCreate()
        scheduler.flushSoon() // an app start sends anything left in the queue
    }
}
