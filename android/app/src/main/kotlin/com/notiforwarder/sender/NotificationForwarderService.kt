package com.notiforwarder.sender

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.Executors

/**
 * Android calls this for every notification once the user grants "Notification access".
 * It only converts the framework object and hands off; the rules live in NotificationParser.
 *
 * Each notification is queued first and sent by a background job, so nothing is lost offline.
 */
class NotificationForwarderService : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val app = application as NotiApp
        val raw = sbn.toRaw()
        // Database work must stay off the main thread. The message is written to the queue
        // before any network is involved.
        executor.execute {
            // Never log message content: it can contain 2FA codes.
            if (app.capture.onNotification(raw)) Log.d(TAG, "queued ${raw.packageName}")
        }
    }

    override fun onListenerConnected() {
        (application as NotiApp).scheduler.flushSoon()
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun StatusBarNotification.toRaw(): RawNotification {
        val extras = notification.extras
        return RawNotification(
            packageName = packageName,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
            bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            postTimeMillis = postTime,
            isOngoing = notification.flags and Notification.FLAG_ONGOING_EVENT != 0,
            isGroupSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isForegroundService = notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0,
        )
    }

    private companion object {
        const val TAG = "NotiForwarder"
    }
}
