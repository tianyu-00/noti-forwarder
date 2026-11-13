package com.notiforwarder.sender

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Sends a text with Android's SmsManager and waits for the system's answer, so "sent" means the
 * phone really handed it to the network and not merely that it was queued. A long text is split
 * into parts and every part must go. Blocking (up to [timeoutMs]): call it off the main thread.
 * Framework code, so it is checked on a real phone; the logic around it is unit tested.
 */
class AndroidSmsSender(private val context: Context, private val timeoutMs: Long = 60_000) : SmsSender {
    override fun send(to: String, text: String): SmsResult {
        val manager = context.getSystemService(SmsManager::class.java) ?: return SmsResult.Failed("no_sms")
        val action = "${context.packageName}.SMS_SENT.${UUID.randomUUID()}"
        val failure = AtomicReference<String?>(null)
        val parts = manager.divideMessage(text)
        val pending = CountDownLatch(parts.size)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (resultCode != Activity.RESULT_OK) failure.compareAndSet(null, reason(resultCode))
                pending.countDown()
            }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
        return try {
            val sentIntents = ArrayList(
                parts.indices.map { i ->
                    PendingIntent.getBroadcast(
                        context, i, Intent(action).setPackage(context.packageName),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
                    )
                },
            )
            manager.sendMultipartTextMessage(to, null, parts, sentIntents, null)
            when {
                !pending.await(timeoutMs, TimeUnit.MILLISECONDS) -> SmsResult.Failed("timeout")
                failure.get() != null -> SmsResult.Failed(failure.get()!!)
                else -> SmsResult.Sent
            }
        } catch (e: SecurityException) {
            SmsResult.Failed("no_permission")
        } catch (e: Exception) {
            SmsResult.Failed("generic")
        } finally {
            runCatching { context.unregisterReceiver(receiver) }
        }
    }

    private fun reason(resultCode: Int) = when (resultCode) {
        SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
        else -> "generic"
    }
}
