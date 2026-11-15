package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// The same cases as server/test/codes.test.js: the phone finds the 2FA code in a decrypted message the same way
// the server does for a plain one, so a code looks the same wherever you see it.
class CodeExtractorTest {
    private fun code(text: String?) = CodeExtractor.extract(text)

    @Test
    fun `finds the code in an ordinary message`() {
        assertEquals("123456", code("Your code is 123456"))
        assertEquals("482913", code("Use 482913 as your one-time passcode. Do not share it."))
    }

    @Test
    fun `finds a code written before the keyword, and ignores a letter prefix`() {
        assertEquals("847291", code("847291 is your verification code"))
        assertEquals("123456", code("G-123456 is your Google verification code."))
    }

    @Test
    fun `joins a code written in groups`() {
        assertEquals("123456", code("Your code is 123 456"))
        assertEquals("123456", code("Your code is 123-456"))
        assertEquals("12345678", code("Security code: 1234 5678"))
    }

    @Test
    fun `accepts codes of 4 to 8 digits`() {
        assertEquals("4821", code("Your PIN is 4821"))
        assertEquals("12345678", code("Auth code 12345678"))
    }

    @Test
    fun `picks the number next to the keyword when there are several`() {
        assertEquals("123456", code("Order 5555 confirmed. Your code is 123456."))
        assertEquals("123456", code("Code 123456 expires in 10 minutes. Call 02071234567 for help."))
    }

    @Test
    fun `understands the Chinese keywords used by apps like WeChat`() {
        assertEquals("654321", code("【微信】验证码 654321，请勿泄露"))
        assertEquals("887766", code("您的验证码是 887766"))
    }

    @Test
    fun `ignores amounts, decimals, long numbers and numbers glued to letters`() {
        assertNull(code("Security alert: £1500 was spent on your card"))
        assertNull(code("Verification code balance 1234.56"))
        assertNull(code("Your code is 12345678901"))
        assertEquals("9988", code("Ref AB123456 code 9988"))
    }

    @Test
    fun `finds nothing when there is no code-like keyword`() {
        assertNull(code("Your order 123456 has shipped"))
        assertNull(code("Meet at 7 on Friday"))
    }

    @Test
    fun `copes with empty input`() {
        assertNull(code(""))
        assertNull(code(null))
    }
}
