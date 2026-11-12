package com.notiforwarder.sender

/**
 * What happens when a notification arrives: parse it, write it to the queue, and only
 * then ask for a flush. The message is safe on disk before any network is involved.
 */
class NotificationCapture(
    private val parser: NotificationParser,
    private val queue: MessageQueue,
    private val scheduler: FlushScheduler,
) {
    /** True if the notification was queued. Blocking: call it off the main thread. */
    fun onNotification(raw: RawNotification): Boolean {
        val message = parser.parse(raw) ?: return false
        queue.enqueue(message)
        scheduler.flushSoon()
        return true
    }
}
