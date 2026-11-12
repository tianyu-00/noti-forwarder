package com.notiforwarder.sender

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** After a reboot or an app update: restart the keep-alive service and send anything still queued. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as NotiApp
        app.scheduler.flushSoon()
        // Only keep a notice on screen for a phone that is actually paired.
        if (app.store.load() != null) {
            ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java))
        }
    }
}
