package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class E2eCipherTest {
    // The same reference message the web tests decrypt (made by a separate Node script), so both
    // sides are proven to agree on the byte format.
    private val key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    private val blob = "e2e:v1:Ii4dPFsHI_YnQXKyUD-DnROc_iU0H0iXDw40L_-M-fU9epD9NRdemW2c3BmEtRw"
    private val cipher = E2eCipher(key)

    @Test
    fun `produces exactly the reference message`() {
        val made = cipher.encrypt("body", "Your code is 482913", app = "com.bank", receivedAtMs = 1762855205000)

        assertEquals(blob, made)
    }

    @Test
    fun `decrypts what it encrypts, only for the field it was made for`() {
        val made = cipher.encrypt("sender", "Bank é中😀", app = "com.bank", receivedAtMs = 1L)

        assertEquals("Bank é中😀", cipher.decrypt("sender", made))
        try {
            cipher.decrypt("body", made)
            fail("a sender must not decrypt as a body")
        } catch (expected: Exception) {
            // authentication failed, as it should
        }
    }

    @Test
    fun `gives the same output for the same message and different output for another`() {
        val a = cipher.encrypt("body", "same", app = "x", receivedAtMs = 5)

        assertEquals(a, cipher.encrypt("body", "same", app = "x", receivedAtMs = 5))
        assertNotEquals(a, cipher.encrypt("body", "same", app = "x", receivedAtMs = 6))
        assertNotEquals(a, cipher.encrypt("body", "other", app = "x", receivedAtMs = 5))
    }

    @Test
    fun `accepts only a 32 byte base64url key`() {
        assertTrue(E2eCipher.isValidKey(key))
        assertFalse(E2eCipher.isValidKey(""))
        assertFalse(E2eCipher.isValidKey("not a key"))
        assertFalse(E2eCipher.isValidKey(key + "x"))
        assertFalse(E2eCipher.isValidKey(key.dropLast(1)))
    }
}
