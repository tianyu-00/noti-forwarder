package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageDescriberTest {
    private fun msg(type: String = "sms", app: String = "sms", label: String? = null, sender: String = "BANK", device: String? = "Kitchen phone") =
        ReceivedMessage("m1", "d1", device, type, app, label, sender, "body", "2026-11-11T10:00:05.000Z", null)

    private fun read(body: String = "Your code is 482913", sender: String = "BANK", code: String? = null, locked: Boolean = false) =
        ReadableMessage(sender, body, code, locked)

    @Test
    fun `a text is named by its sender, and an app notification by its real name and title`() {
        assertEquals("SMS from BANK", MessageDescriber.describe(msg(), read()).source)
        assertEquals("SMS from unknown number", MessageDescriber.describe(msg(sender = ""), read(sender = "")).source)
        assertEquals("Gmail: Run failed", MessageDescriber.describe(msg("notification", "com.google.android.gm", "Gmail"), read(sender = "Run failed")).source)
        assertEquals("com.example.bank", MessageDescriber.describe(msg("notification", "com.example.bank"), read(sender = "")).source)
    }

    @Test
    fun `the title carries the 2FA code when there is one`() {
        val d = MessageDescriber.describe(msg(), read(code = "482913"))

        assertEquals("🔑 482913 · SMS from BANK", d.title)
        assertEquals("482913", d.code)
        assertEquals("SMS from BANK", MessageDescriber.describe(msg(), read()).title)
    }

    @Test
    fun `a locked message says it needs the key, and has no text or code`() {
        val d = MessageDescriber.describe(msg(), read(body = "", sender = "", locked = true))

        assertTrue(d.locked)
        assertEquals("New message", d.title)
        assertEquals("Add the encryption key to read it.", d.text)
        assertNull(d.code)
    }

    @Test
    fun `the phone it came to is named, or left out when an older server does not say`() {
        assertEquals("Kitchen phone", MessageDescriber.describe(msg(), read()).device)
        assertNull(MessageDescriber.describe(msg(device = null), read()).device)
        assertNull(MessageDescriber.describe(msg(device = "  "), read()).device)
    }

    @Test
    fun `long text is cut`() {
        val d = MessageDescriber.describe(msg(), read(body = "x".repeat(5000)))

        assertTrue(d.text.length <= 1001)
        assertTrue(d.text.endsWith("…"))
        assertFalse(MessageDescriber.describe(msg(), read(body = "short")).text.endsWith("…"))
    }
}
