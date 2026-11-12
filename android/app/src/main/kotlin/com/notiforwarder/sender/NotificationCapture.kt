package com.notiforwarder.sender

/** Runs something after a delay (the real one uses a scheduled executor). */
fun interface Delayer {
    fun after(delayMillis: Long, block: () -> Unit)
}

/**
 * What happens when a notification arrives: apply the user's settings, parse it, write it to
 * the queue, and only then ask for a flush. The message is safe on disk before any network
 * is involved.
 */
class NotificationCapture(
    private val parser: NotificationParser,
    private val queue: MessageQueue,
    private val scheduler: FlushScheduler,
    private val settings: () -> CaptureSettings = { CaptureSettings() },
    private val dedupe: SmsDeduplicator? = null,
    /** Packages of the default SMS app. Their notifications can repeat an SMS we already captured. */
    private val smsPackages: () -> Set<String> = { emptySet() },
    private val delayer: Delayer = Delayer { _, block -> block() },
) {
    /**
     * True if the notification was queued right away. A notification from the SMS app is held
     * briefly instead, so the SMS broadcast can arrive first; it returns false for those.
     * Blocking: call it off the main thread.
     */
    fun onNotification(raw: RawNotification): Boolean {
        val current = settings()
        if (!current.sendNotifications || current.isBlocked(raw.packageName)) return false

        val fromSmsApp = raw.packageName in smsPackages()
        // The SMS app's notification contains the text of the SMS, so "no SMS" must cover it too.
        if (fromSmsApp && !current.sendSms) return false

        val message = parser.parse(raw) ?: return false

        if (fromSmsApp && dedupe != null) {
            if (dedupe.isDuplicateOfRecentSms(message.body)) return false
            delayer.after(SMS_HOLD_MILLIS) {
                if (!dedupe.isDuplicateOfRecentSms(message.body)) enqueue(message)
            }
            return false
        }
        enqueue(message)
        return true
    }

    private fun enqueue(message: Message) {
        queue.enqueue(message)
        scheduler.flushSoon()
    }

    private companion object {
        const val SMS_HOLD_MILLIS = 3_000L
    }
}
