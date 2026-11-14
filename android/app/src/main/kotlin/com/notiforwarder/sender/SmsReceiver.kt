package com.notiforwarder.sender

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import java.util.concurrent.Executors

/**
 * Android delivers every incoming text here once the user grants the SMS permission.
 * It only converts the framework objects; the rules live in SmsCapture and SmsParser.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            ?.map { RawSmsPart(it.originatingAddress, it.messageBody, it.timestampMillis) }
            ?: return
        // Which SIM got it: Android puts its subscription id on the broadcast (-1 when it does not know).
        val sim = intent.getIntExtra("subscription", -1).takeIf { it >= 0 }
        val app = context.applicationContext as NotiApp
        // Database work must not run on the main thread; goAsync keeps the receiver alive for it.
        val pending = goAsync()
        executor.execute {
            try {
                app.smsCapture.onSms(parts, sim)
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        val executor = Executors.newSingleThreadExecutor()
    }
}
