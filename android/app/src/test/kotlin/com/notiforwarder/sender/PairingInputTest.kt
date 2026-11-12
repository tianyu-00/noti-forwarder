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

    @Test
    fun `accepts a cleartext address on the local network`() {
        val qr = PairingInput.fromQr("""{"u":"http://192.168.1.20:8006","c":"$code"}""")
        val manual = PairingInput.fromManual("http://rpi-server:8006/", code)

        assertEquals(PairingResult.Ok(PairingTarget("http://192.168.1.20:8006", code)), qr)
        assertEquals(PairingResult.Ok(PairingTarget("http://rpi-server:8006", code)), manual)
    }

    @Test
    fun `refuses cleartext for anything that is not on the local network`() {
        assertInvalid(PairingInput.fromManual("http://8.8.8.8:3000", code))
        assertInvalid(PairingInput.fromManual("http://192.168.1.20.evil.com", code))
        assertInvalid(PairingInput.fromManual("http://192.168.1.20@evil.com", code))
        assertInvalid(PairingInput.fromQr("""{"u":"http://172.32.0.1","c":"$code"}"""))
    }

    @Test
    fun `manual entry without a scheme uses http on the local network and https elsewhere`() {
        assertEquals(
            PairingResult.Ok(PairingTarget("http://192.168.1.20:8006", code)),
            PairingInput.fromManual("192.168.1.20:8006", code),
        )
        assertEquals(
            PairingResult.Ok(PairingTarget("https://nf.example.com", code)),
            PairingInput.fromManual("nf.example.com", code),
        )
    }
}
