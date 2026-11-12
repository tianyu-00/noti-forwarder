package com.notiforwarder.sender

import android.app.Application
import android.os.Build

/** Wires the pure classes together once per process. */
class NotiApp : Application() {
    val store: TokenStore by lazy { EncryptedTokenStore(this) }
    val parser by lazy { NotificationParser(ownPackage = packageName) }
    // The service runs without a screen, so a revocation must reach the UI state from here.
    val sender by lazy {
        MessageSender(store, appVersion = BuildConfig.VERSION_NAME, onRevoked = { controller.refresh() })
    }
    val controller by lazy {
        PairingController(
            store = store,
            flow = PairingFlow(store, PairingClient()),
            device = DeviceInfo(
                name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                model = Build.MODEL,
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
    }
}
