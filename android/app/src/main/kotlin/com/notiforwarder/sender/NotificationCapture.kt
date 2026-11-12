package com.notiforwarder.sender

/** What became of a notification: decides whether the service may dismiss it afterwards. */
enum class CaptureOutcome {
    /** Not forwarded (filtered out, ongoing, our own...). Left alone. */
    IGNORED,

    /** Written to the queue. Safe to dismiss. */
    QUEUED,

    /** Repeats an SMS already captured, so nothing to forward. Safe to dismiss. */
    COPY_OF_SMS,
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
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /**
     * True if the notification was stored. One from the SMS app is stored at once but not sent
     * for a few seconds, so the SMS broadcast can arrive first and replace it; being on disk
     * from the start means a crash in that window loses nothing.
     * Blocking: call it off the main thread.
     */
    fun onNotification(raw: RawNotification): Boolean = handle(raw) == CaptureOutcome.QUEUED

    /** Like [onNotification] but says what happened, so the caller can dismiss it when allowed. */
    fun handle(raw: RawNotification): CaptureOutcome {
        val current = settings()
        if (!current.sendNotifications || current.isBlocked(raw.packageName)) return CaptureOutcome.IGNORED

        val fromSmsApp = raw.packageName in smsPackages()
        // The SMS app's notification contains the text of the SMS, so "no SMS" must cover it too.
        if (fromSmsApp && !current.sendSms) return CaptureOutcome.IGNORED

        val message = parser.parse(raw) ?: return CaptureOutcome.IGNORED

        if (fromSmsApp && dedupe != null) {
            if (dedupe.isDuplicateOfRecentSms(message.body)) return CaptureOutcome.COPY_OF_SMS
            queue.enqueue(message, notBefore = clock() + SMS_HOLD_MILLIS)
            scheduler.flushAfter(SMS_HOLD_MILLIS)
            return CaptureOutcome.QUEUED
        }
        enqueue(message)
        return CaptureOutcome.QUEUED
    }

    private fun enqueue(message: Message) {
        queue.enqueue(message)
        scheduler.flushSoon()
    }

    private companion object {
        const val SMS_HOLD_MILLIS = 3_000L
    }
}
