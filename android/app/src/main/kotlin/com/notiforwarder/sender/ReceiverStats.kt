package com.notiforwarder.sender

import java.time.Instant

/** The two numbers on the receiver's Status page, worked out from the phone's own copy of the messages. */
data class ReceiverStats(
    val today: Int,
    /** When the newest message was received (the sender phone's clock), or null if there are none. */
    val lastAt: Long?,
)

fun receiverStats(messages: List<ReceivedMessage>, startOfToday: Long): ReceiverStats {
    val times = messages.mapNotNull { runCatching { Instant.parse(it.receivedAt).toEpochMilli() }.getOrNull() }
    return ReceiverStats(today = times.count { it >= startOfToday }, lastAt = times.maxOrNull())
}
