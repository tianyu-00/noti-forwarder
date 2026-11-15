package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class ReceiverStatsTest {
    private val startOfToday = Instant.parse("2026-11-15T00:00:00Z").toEpochMilli()

    private fun message(id: String, at: String) =
        ReceivedMessage(id = id, deviceId = "d1", type = "sms", app = "sms", body = "hi", receivedAt = at)

    private fun stats(vararg messages: ReceivedMessage) = receiverStats(messages.toList(), startOfToday)

    @Test
    fun `no messages gives zero and no last time`() {
        val s = stats()
        assertEquals(0, s.today)
        assertNull(s.lastAt)
    }

    @Test
    fun `counts only what came today`() {
        val s = stats(
            message("a", "2026-11-15T09:00:00Z"),
            message("b", "2026-11-15T01:00:00Z"),
            message("c", "2026-11-14T23:59:59Z"),
        )
        assertEquals(2, s.today)
    }

    @Test
    fun `last time is the newest message, whatever the order`() {
        val s = stats(message("a", "2026-11-14T09:00:00Z"), message("b", "2026-11-15T09:00:00Z"))
        assertEquals(Instant.parse("2026-11-15T09:00:00Z").toEpochMilli(), s.lastAt)
    }

    @Test
    fun `a message with an unreadable time is ignored`() {
        val s = stats(message("a", "garbage"))
        assertEquals(0, s.today)
        assertNull(s.lastAt)
    }
}
