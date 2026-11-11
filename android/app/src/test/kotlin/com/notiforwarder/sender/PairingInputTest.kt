package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingInputTest {
    private val code = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23"

    private fun assertInvalid(result: PairingResult) =
        assertTrue("expected Invalid but was $result", result is PairingResult.Invalid)

    @Test
    fun `parses the QR payload shown by the dashboard`() {
        val result = PairingInput.fromQr("""{"u":"https://nf.example.com","c":"$code"}""")

        assertEquals(PairingResult.Ok(PairingTarget("https://nf.example.com", code)), result)
    }

    @Test
    fun `rejects QR text that is not the expected JSON`() {
        assertInvalid(PairingInput.fromQr("https://example.com/not-ours"))
        assertInvalid(PairingInput.fromQr(""))
        assertInvalid(PairingInput.fromQr("""{"u":"https://nf.example.com"}"""))
        assertInvalid(PairingInput.fromQr("""{"c":"$code"}"""))
    }

    @Test
    fun `rejects a QR code that points at a cleartext server`() {
        assertInvalid(PairingInput.fromQr("""{"u":"http://nf.example.com","c":"$code"}"""))
    }

    @Test
    fun `manual entry adds https, trims spaces and strips trailing slashes`() {
        val result = PairingInput.fromManual("  nf.example.com/  ", "  $code ")

        assertEquals(PairingResult.Ok(PairingTarget("https://nf.example.com", code)), result)
    }

    @Test
    fun `manual entry keeps an explicit https address`() {
        val result = PairingInput.fromManual("https://nf.example.com:8443//", code)

        assertEquals(PairingResult.Ok(PairingTarget("https://nf.example.com:8443", code)), result)
    }

    @Test
    fun `manual entry refuses http and blank values`() {
        assertInvalid(PairingInput.fromManual("http://nf.example.com", code))
        assertInvalid(PairingInput.fromManual("", code))
        assertInvalid(PairingInput.fromManual("nf.example.com", "   "))
    }
}
