package com.notiforwarder.sender

import android.app.Application
import android.os.Build

/** Wires the pure classes together once per process. */
class NotiApp : Application() {
    val store: TokenStore by lazy { EncryptedTokenStore(this) }
    val parser by lazy { NotificationParser(ownPackage = packageName) }
    val sender by lazy { MessageSender(store, appVersion = BuildConfig.VERSION_NAME) }
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
