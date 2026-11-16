package com.notiforwarder.sender

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PersistableBundle
import android.widget.Toast
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Shows the receiver's alerts as ordinary Android notifications. Framework code, checked on a phone. Messages
 * and 2FA codes get their own channels, so each can be set to pop up (or stay quiet) in Android's settings.
 * Every alert carries a tag and the message's key, so deleting a message on the dashboard removes its notification.
 */
class AndroidAlertSink(private val context: Context) : AlertSink {
    private val manager = NotificationManagerCompat.from(context)

    init {
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_MESSAGES, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Messages")
                .setDescription("Texts and app notifications from your sender phones")
                .build(),
        )
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_CODES, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("2FA codes")
                .setDescription("Messages that contain a one-time code")
                .build(),
        )
        // The first version of this channel was a quiet one, and Android keeps a channel's importance once made.
        manager.deleteNotificationChannel("receiver_status")
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_STATUS, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Phone status")
                .setDescription("A sender phone has stopped checking in, or is back")
                .build(),
        )
    }

    private fun allowed() = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    override fun show(plan: AlertPlan) {
        if (!allowed()) return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, if (plan.high) CHANNEL_CODES else CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_alert)
            .setContentTitle(plan.title)
            .setContentText(plan.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(plan.text))
            .setSubText(plan.subText)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(if (plan.high) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        plan.code?.let { code ->
            val copy = PendingIntent.getBroadcast(
                context,
                plan.key.hashCode(),
                Intent(context, CopyCodeReceiver::class.java).putExtra(CopyCodeReceiver.EXTRA_CODE, code),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(0, "Copy code", copy)
        }
        try {
            manager.notify(TAG, plan.key.hashCode(), builder.build())
        } catch (e: SecurityException) {
            // The permission was taken away between the check and now: no alert, and nothing else to do.
        }
    }

    override fun showStatus(plan: StatusPlan) {
        if (!allowed()) return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_STATUS)
            .setSmallIcon(R.drawable.ic_stat_alert)
            .setContentTitle(plan.title)
            .setContentText(plan.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(plan.text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build()
        try {
            manager.notify(TAG, plan.key.hashCode(), notification)
        } catch (e: SecurityException) {
            // The permission was taken away between the check and now.
        }
    }

    override fun cancel(keys: List<String>) = keys.forEach { manager.cancel(TAG, it.hashCode()) }

    override fun cancelAll() {
        val shown = context.getSystemService(android.app.NotificationManager::class.java).activeNotifications
        shown.filter { it.tag == TAG }.forEach { manager.cancel(TAG, it.id) }
    }

    private companion object {
        const val TAG = "alert"
        const val CHANNEL_MESSAGES = "receiver_messages"
        const val CHANNEL_CODES = "receiver_codes"
        const val CHANNEL_STATUS = "receiver_phone_status"
    }
}

/** The "Copy code" button on a 2FA alert: puts the code on the clipboard, marked sensitive so Android hides the preview. */
class CopyCodeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val code = intent.getStringExtra(EXTRA_CODE) ?: return
        val clip = ClipData.newPlainText("2FA code", code)
        if (Build.VERSION.SDK_INT >= 33) {
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        }
        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
        Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val EXTRA_CODE = "code"
    }
}
