package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageReaderTest {
    private val key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    private val otherKey = "HxwbGhkYFxYVFBMSERAPDg0MCwoJCAcGBQQDAgEAAB8"
    private val at = 1_762_855_205_000L

    private fun plain(body: String, sender: String = "BANK", code: String? = null) = ReceivedMessage(
        id = "m1", deviceId = "d1", deviceName = "Kitchen", type = "sms", app = "sms", appLabel = null,
        sender = sender, body = body, receivedAt = "2026-11-11T10:00:05.000Z", code = code,
    )

    private fun sealed(body: String, sender: String = "BANK", withKey: String = key) = plain(
        body = E2eCipher(withKey).encrypt("body", body, "sms", at),
        sender = if (sender.isEmpty()) "" else E2eCipher(withKey).encrypt("sender", sender, "sms", at),
    )

    @Test
    fun `a plain message is read as it is, and uses the code the server found`() {
        val read = MessageReader { null }.read(plain("Your code is 482913", code = "482913"))

        assertEquals("BANK", read.sender)
        assertEquals("Your code is 482913", read.body)
        assertEquals("482913", read.code)
        assertFalse(read.locked)
    }

    @Test
    fun `a plain message with no code from the server is still checked for one`() {
        assertEquals("123456", MessageReader { null }.read(plain("Your code is 123456")).code)
    }

    @Test
    fun `an encrypted message is decrypted on the phone, and its code is found after decrypting`() {
        val read = MessageReader { key }.read(sealed("Your code is 482913"))

        assertEquals("BANK", read.sender)
        assertEquals("Your code is 482913", read.body)
        assertEquals("482913", read.code)
        assertFalse(read.locked)
    }

    @Test
    fun `an empty sender stays empty`() {
        assertEquals("", MessageReader { key }.read(sealed("hello", sender = "")).sender)
    }

    @Test
    fun `without the key, or with the wrong one, the message is locked and shows no text`() {
        val message = sealed("Your code is 482913")

        for (read in listOf(MessageReader { null }.read(message), MessageReader { otherKey }.read(message))) {
            assertTrue(read.locked)
            assertEquals("", read.body)
            assertNull(read.code)
        }
    }

    @Test
    fun `the message itself is never changed, so it can be stored as received`() {
        val message = sealed("hi")

        MessageReader { key }.read(message)

        assertTrue(message.body.startsWith("e2e:v1:"))
    }
}
