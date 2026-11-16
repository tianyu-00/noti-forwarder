package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationParserTest {
    private val parser = NotificationParser(ownPackage = "com.notiforwarder.sender")

    private fun raw(
        packageName: String = "com.bank",
        title: String? = "Bank",
        text: String? = "Your code is 123456",
        bigText: String? = null,
        postTime: Long = 1_762_855_205_000L, // 2025-11-11T10:00:05Z
        ongoing: Boolean = false,
        groupSummary: Boolean = false,
        foregroundService: Boolean = false,
    ) = RawNotification(packageName, title, text, bigText, postTime, ongoing, groupSummary, foregroundService)

    @Test
    fun `ignores this app's own notifications, and those of its release or dev twin installed beside it`() {
        // The signed app and the dev build are separate apps on one phone. Neither may forward the other's alerts,
        // which carry message text and 2FA codes (and clearing them after forwarding would also remove them at once).
        assertNull(parser.parse(raw(packageName = "com.notiforwarder.sender")))
        assertNull(parser.parse(raw(packageName = "com.notiforwarder.sender.debug")))
        val dev = NotificationParser(ownPackage = "com.notiforwarder.sender.debug")
        assertNull(dev.parse(raw(packageName = "com.notiforwarder.sender.debug")))
        assertNull(dev.parse(raw(packageName = "com.notiforwarder.sender")))
    }

    @Test
    fun `still forwards an app whose name only starts like this one`() {
        assertNotNull(parser.parse(raw(packageName = "com.notiforwarder.sender.other")))
        assertNotNull(parser.parse(raw(packageName = "com.notiforwarder.senderx")))
    }

    @Test
    fun `maps a notification to a message`() {
        val message = parser.parse(raw())!!

        assertEquals("notification", message.type)
        assertEquals("com.bank", message.app)
        assertEquals("Bank", message.sender)
        assertEquals("Your code is 123456", message.body)
        assertEquals("2025-11-11T10:00:05Z", message.receivedAt)
        assertEquals(
            true,
            Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").matches(message.id),
        )
    }

    @Test
    fun `prefers the expanded text when there is one`() {
        val message = parser.parse(raw(text = "Short", bigText = "The whole long message"))!!

        assertEquals("The whole long message", message.body)
    }

    @Test
    fun `falls back to the title when there is no text, and skips when everything is blank`() {
        assertEquals("Only a title", parser.parse(raw(title = "Only a title", text = null))!!.body)
        assertEquals("Only a title", parser.parse(raw(title = "Only a title", text = "  "))!!.body)
        assertNull(parser.parse(raw(title = null, text = null)))
        assertNull(parser.parse(raw(title = " ", text = "")))
    }

    @Test
    fun `skips noise that should never be forwarded`() {
        assertNull(parser.parse(raw(packageName = "com.notiforwarder.sender")))
        assertNull(parser.parse(raw(ongoing = true)))
        assertNull(parser.parse(raw(foregroundService = true)))
        assertNull(parser.parse(raw(groupSummary = true)))
        assertNotNull(parser.parse(raw()))
    }

    @Test
    fun `gives every message its own id`() {
        assertNotEquals(parser.parse(raw())!!.id, parser.parse(raw())!!.id)
    }
}
