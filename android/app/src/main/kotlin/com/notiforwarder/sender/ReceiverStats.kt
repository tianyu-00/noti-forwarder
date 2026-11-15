package com.notiforwarder.sender

import java.time.Instant

/** How many messages one sender phone has put on this receiver. */
data class PhoneCount(val name: String, val count: Int)

/** The numbers on the receiver's Status page, worked out from the phone's own copy of the messages. */
data class ReceiverStats(
    val held: Int,
    val today: Int,
    val codesToday: Int,
    /** When the newest message was received (the sender phone's clock), or null if there are none. */
    val lastAt: Long?,
    val phones: List<PhoneCount>,
)

/** [isCode] says whether a message holds a 2FA code; it is passed in because an encrypted one is only known once read. */
fun receiverStats(messages: List<ReceivedMessage>, startOfToday: Long, isCode: (ReceivedMessage) -> Boolean): ReceiverStats {
    val times = messages.map { it to runCatching { Instant.parse(it.receivedAt).toEpochMilli() }.getOrNull() }
    val todays = times.filter { (_, at) -> at != null && at >= startOfToday }.map { it.first }
    return ReceiverStats(
        held = messages.size,
        today = todays.size,
        codesToday = todays.count(isCode),
        lastAt = times.mapNotNull { it.second }.maxOrNull(),
        phones = messages.groupingBy { it.deviceName ?: "Phone" }.eachCount()
            .map { (name, count) -> PhoneCount(name, count) }
            .sortedWith(compareByDescending<PhoneCount> { it.count }.thenBy { it.name }),
    )
}
