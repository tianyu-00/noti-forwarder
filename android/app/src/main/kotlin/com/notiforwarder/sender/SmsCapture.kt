package com.notiforwarder.sender

/** Incoming texts: apply the user's setting, queue them first, then ask for a flush. */
class SmsCapture(
    private val parser: SmsParser,
    private val queue: MessageQueue,
    private val scheduler: FlushScheduler,
    private val settings: () -> CaptureSettings,
    private val dedupe: SmsDeduplicator,
) {
    /** Returns how many texts were queued. Blocking: call it off the main thread. */
    fun onSms(parts: List<RawSmsPart>): Int {
        if (!settings().sendSms) return 0
        val messages = parser.parse(parts)
        for (message in messages) {
            // Remember it first, so the messaging app's notification copy is recognised.
            dedupe.recordSms(message.body)
            queue.enqueue(message)
        }
        if (messages.isNotEmpty()) scheduler.flushSoon()
        return messages.size
    }
}
