package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertPlannerTest {
    private fun message(type: String = "sms", app: String = "sms", appLabel: String? = null, sender: String = "BANK", body: String = "Hello", device: String? = "Kitchen phone") =
        ReceivedMessage("m1", "d1", device, type, app, appLabel, sender, body, "2026-11-11T10:00:05.000Z", null)

    private fun read(m: ReceivedMessage, locked: Boolean = false, code: String? = null) =
        ReadableMessage(sender = m.sender, body = m.body, code = code, locked = locked)

    private val all = ReceiverSettings()
    private fun plan(m: ReceivedMessage, r: ReadableMessage = read(m), s: ReceiverSettings = all) = AlertPlanner.plan(m, r, s)

    @Test
    fun `a text shows who sent it and what it says, with the phone it came to`() {
        val p = plan(message(sender = "+447700900123", body = "Running late"))!!

        assertEquals("SMS from +447700900123", p.title)
        assertEquals("Running late", p.text)
        assertEquals("Kitchen phone", p.subText)
        assertFalse(p.high)
    }

    @Test
    fun `a text from an unknown number still reads well`() {
        assertEquals("SMS from unknown number", plan(message(sender = ""))!!.title)
    }

    @Test
    fun `an app notification is named by the app's real name, with its title`() {
        val m = message(type = "notification", app = "com.google.android.gm", appLabel = "Gmail", sender = "Run failed", body = "build 42")

        assertEquals("Gmail: Run failed", plan(m)!!.title)
        assertEquals("com.example.bank", plan(message(type = "notification", app = "com.example.bank", sender = "", body = "x"))!!.title)
    }

    @Test
    fun `a message with a 2FA code puts the code in the title and is urgent`() {
        val m = message(body = "Your code is 482913")

        val p = plan(m, read(m, code = "482913"))!!

        assertEquals("🔑 482913 · SMS from BANK", p.title)
        assertTrue(p.high)
        assertEquals("482913", p.code)
    }

    @Test
    fun `a locked message still alerts, but says only that something arrived`() {
        val m = message(body = "e2e:v1:xxxx")

        val p = plan(m, read(m, locked = true))!!

        assertEquals("New message", p.title)
        assertEquals("Add the encryption key to read it.", p.text)
        assertEquals("Kitchen phone", p.subText)
    }

    @Test
    fun `only the kinds of message the user wants are shown`() {
        val onlyTexts = all.copy(types = setOf("sms"))

        assertNotNull(plan(message(type = "sms"), s = onlyTexts))
        assertNull(plan(message(type = "notification"), s = onlyTexts))
    }

    @Test
    fun `an app the user turned off never alerts`() {
        val blocked = all.copy(blockedApps = setOf("com.example.game"))

        assertNull(plan(message(type = "notification", app = "com.example.game"), s = blocked))
        assertNotNull(plan(message(type = "notification", app = "com.example.bank"), s = blocked))
    }

    @Test
    fun `codes only mode alerts for a message with a code and nothing else`() {
        val codesOnly = all.copy(mode = AlertMode.CodesOnly)
        val withCode = message(body = "Your code is 123456")
        val without = message(body = "See you later")

        assertNotNull(plan(withCode, read(withCode, code = "123456"), codesOnly))
        assertNull(plan(without, s = codesOnly))
        assertNull(plan(message(body = "e2e:v1:x"), read(message(), locked = true), codesOnly))
    }

    @Test
    fun `turning alerts off silences everything`() {
        assertNull(plan(message(), s = all.copy(enabled = false)))
    }

    @Test
    fun `a very long text is cut`() {
        val p = plan(message(body = "x".repeat(5000)))!!

        assertTrue(p.text.length <= 1001)
        assertTrue(p.text.endsWith("…"))
    }

    @Test
    fun `each message has its own notification key, so a later one never replaces an earlier one`() {
        val a = plan(message())!!
        val b = plan(message().copy(id = "m2"))!!

        assertEquals("m1", a.key)
        assertEquals("m2", b.key)
    }
}
