package com.notiforwarder.sender

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** After a reboot or an app update: restart the keep-alive service and send anything still queued. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = context.applicationContext as NotiApp
        val receiver = app.role == AppRole.Receiver
        if (!receiver) app.scheduler.flushSoon()
        // Only keep a notice on screen for a phone that is actually paired.
        if (app.store.load() != null) {
            val service = if (receiver) ReceiverService::class.java else KeepAliveService::class.java
            ContextCompat.startForegroundService(context, Intent(context, service))
        }
    }
}
