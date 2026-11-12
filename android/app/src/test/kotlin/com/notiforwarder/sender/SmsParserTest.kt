package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SmsParserTest {
    private var counter = 0
    private val parser = SmsParser { "id-${++counter}" }
    private val time = 1_762_855_205_000L // 2025-11-11T10:00:05Z

    private fun part(address: String?, body: String?, at: Long = time) = RawSmsPart(address, body, at)

    @Test
    fun `turns one text into an sms message`() {
        val messages = parser.parse(listOf(part("+447700900123", "Your code is 123456")))

        assertEquals(
            listOf(
                Message(
                    id = "id-1",
                    type = "sms",
                    app = "sms",
                    sender = "+447700900123",
                    body = "Your code is 123456",
                    receivedAt = "2025-11-11T10:00:05Z",
                ),
            ),
            messages,
        )
    }

    @Test
    fun `joins the parts of a long text, in order`() {
        val messages = parser.parse(
            listOf(
                part("BANK", "Your statement is ready. "),
                part("BANK", "Log in to see "),
                part("BANK", "the details."),
            ),
        )

        assertEquals(1, messages.size)
        assertEquals("Your statement is ready. Log in to see the details.", messages.single().body)
    }

    @Test
    fun `keeps texts from different senders separate`() {
        val messages = parser.parse(listOf(part("BANK", "one"), part("MUM", "two"), part("BANK", " three")))

        assertEquals(listOf("BANK" to "one three", "MUM" to "two"), messages.map { it.sender to it.body })
        assertNotEquals(messages[0].id, messages[1].id)
    }

    @Test
    fun `skips empty texts and tolerates a missing number`() {
        assertEquals(emptyList<Message>(), parser.parse(listOf(part("BANK", null), part("BANK", "   "))))

        val noNumber = parser.parse(listOf(part(null, "who sent this")))
        assertEquals("", noNumber.single().sender)
    }
}
