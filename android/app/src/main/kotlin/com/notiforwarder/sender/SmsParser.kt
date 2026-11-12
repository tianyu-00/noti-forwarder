package com.notiforwarder.sender

import java.time.Instant
import java.util.UUID

/** Plain copy of one received SMS part, so the joining rules are testable without Android. */
data class RawSmsPart(val address: String?, val body: String?, val timestampMillis: Long)

class SmsParser(private val newId: () -> String = { UUID.randomUUID().toString() }) {
    /**
     * A long text arrives as several parts. Parts from the same sender are joined in order
     * into one message; texts from different senders stay separate.
     */
    fun parse(parts: List<RawSmsPart>): List<Message> =
        parts.groupBy { it.address.orEmpty() }.mapNotNull { (address, group) ->
            val body = group.joinToString("") { it.body.orEmpty() }
            if (body.isBlank()) {
                null
            } else {
                Message(
                    id = newId(),
                    type = "sms",
                    app = "sms",
                    sender = address,
                    body = body,
                    receivedAt = Instant.ofEpochMilli(group.first().timestampMillis).toString(),
                )
            }
        }
}
