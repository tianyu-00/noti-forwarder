package com.notiforwarder.sender

/** What the status screen shows about sending. */
data class QueueStatus(val queued: Int, val quarantined: Int, val lastSuccessAt: Long?)

class StatusReader(private val queue: MessageQueue, private val sendStatus: SendStatus) {
    /** Blocking: call it off the main thread. */
    fun snapshot() = QueueStatus(queue.count(), queue.quarantinedCount(), sendStatus.lastSuccessAt())
}

/** "never", "just now", "5 minutes ago"... */
fun describeAgo(thenMillis: Long?, nowMillis: Long): String {
    if (thenMillis == null) return "never"
    val minutes = ((nowMillis - thenMillis) / 60_000).coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> plural(minutes, "minute")
        minutes < 24 * 60 -> plural(minutes / 60, "hour")
        else -> plural(minutes / (24 * 60), "day")
    }
}

private fun plural(count: Long, unit: String) = "$count $unit${if (count == 1L) "" else "s"} ago"
