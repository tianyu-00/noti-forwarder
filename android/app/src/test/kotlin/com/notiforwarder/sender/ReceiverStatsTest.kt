package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class ReceiverStatsTest {
    private val startOfToday = Instant.parse("2026-11-15T00:00:00Z").toEpochMilli()

    private fun message(id: String, at: String, device: String? = "Kitchen phone", deviceId: String = "d1") =
        ReceivedMessage(id = id, deviceId = deviceId, deviceName = device, type = "sms", app = "sms", body = "hi", receivedAt = at)

    private fun stats(messages: List<ReceivedMessage>, isCode: (ReceivedMessage) -> Boolean = { false }) =
        receiverStats(messages, startOfToday, isCode)

    @Test
    fun `no messages gives zeros and no last time`() {
        val s = stats(emptyList())
        assertEquals(0, s.held)
        assertEquals(0, s.today)
        assertEquals(0, s.codesToday)
        assertNull(s.lastAt)
        assertEquals(emptyList<PhoneCount>(), s.phones)
    }

    @Test
    fun `counts everything held and only what came today`() {
        val s = stats(
            listOf(
                message("a", "2026-11-15T09:00:00Z"),
                message("b", "2026-11-15T01:00:00Z"),
                message("c", "2026-11-14T23:59:59Z"),
            ),
        )
        assertEquals(3, s.held)
        assertEquals(2, s.today)
    }

    @Test
    fun `last time is the newest message, whatever the order`() {
        val s = stats(listOf(message("a", "2026-11-14T09:00:00Z"), message("b", "2026-11-15T09:00:00Z")))
        assertEquals(Instant.parse("2026-11-15T09:00:00Z").toEpochMilli(), s.lastAt)
    }

    @Test
    fun `counts today's codes with the given test, so encrypted ones count once read`() {
        val s = stats(
            listOf(message("a", "2026-11-15T09:00:00Z"), message("b", "2026-11-15T10:00:00Z"), message("c", "2026-11-14T10:00:00Z")),
            isCode = { it.id != "b" },
        )
        assertEquals(1, s.codesToday) // "a" today; "c" is code-like but yesterday; "b" is not a code
    }

    @Test
    fun `groups by the sender phone, busiest first, then by name`() {
        val s = stats(
            listOf(
                message("a", "2026-11-15T09:00:00Z", "Zed", "z"),
                message("b", "2026-11-15T09:01:00Z", "Kitchen phone", "k"),
                message("c", "2026-11-15T09:02:00Z", "Kitchen phone", "k"),
                message("d", "2026-11-15T09:03:00Z", "Alpha", "a"),
            ),
        )
        assertEquals(listOf(PhoneCount("Kitchen phone", 2), PhoneCount("Alpha", 1), PhoneCount("Zed", 1)), s.phones)
    }

    @Test
    fun `a phone with no name from an older server is called Phone`() {
        val s = stats(listOf(message("a", "2026-11-15T09:00:00Z", device = null)))
        assertEquals(listOf(PhoneCount("Phone", 1)), s.phones)
    }

    @Test
    fun `a message with an unreadable time still counts as held but not as today`() {
        val s = stats(listOf(message("a", "garbage")))
        assertEquals(1, s.held)
        assertEquals(0, s.today)
        assertNull(s.lastAt)
    }
}
