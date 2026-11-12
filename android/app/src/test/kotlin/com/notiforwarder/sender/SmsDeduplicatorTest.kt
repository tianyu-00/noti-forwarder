package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsDeduplicatorTest {
    private var now = 1_000_000L
    private val dedupe = SmsDeduplicator(clock = { now }, windowMillis = 120_000, maxEntries = 3)

    @Test
    fun `a notification with the same text as a recent sms is a duplicate`() {
        dedupe.recordSms("Your code is 123456")

        assertTrue(dedupe.isDuplicateOfRecentSms("Your code is 123456"))
    }

    @Test
    fun `different text is not a duplicate`() {
        dedupe.recordSms("Your code is 123456")

        assertFalse(dedupe.isDuplicateOfRecentSms("Your parcel has shipped"))
    }

    @Test
    fun `the same text long after the first is a new message, not a duplicate`() {
        dedupe.recordSms("Your code is 123456")

        now += 119_999
        assertTrue(dedupe.isDuplicateOfRecentSms("Your code is 123456"))
        now += 2
        assertFalse(dedupe.isDuplicateOfRecentSms("Your code is 123456"))
    }

    @Test
    fun `whitespace differences do not matter`() {
        dedupe.recordSms("Your code\nis  123456 ")

        assertTrue(dedupe.isDuplicateOfRecentSms("  Your code is 123456"))
    }

    @Test
    fun `a notification that truncated the text is still a duplicate`() {
        val full = "Your statement for November is now available. Log in to the app to view it."
        dedupe.recordSms(full)

        assertTrue(dedupe.isDuplicateOfRecentSms("Your statement for November is now avail…"))
        assertTrue(dedupe.isDuplicateOfRecentSms("Your statement for November is now avail..."))
    }

    @Test
    fun `a very short prefix is not enough to call it a duplicate`() {
        dedupe.recordSms("Your code is 123456")

        assertFalse(dedupe.isDuplicateOfRecentSms("Your…"))
    }

    @Test
    fun `remembers only the most recent texts`() {
        for (n in 1..4) {
            dedupe.recordSms("message number $n")
            now += 1_000
        }

        assertFalse(dedupe.isDuplicateOfRecentSms("message number 1")) // pushed out
        assertTrue(dedupe.isDuplicateOfRecentSms("message number 4"))
    }

    @Test
    fun `nothing is a duplicate before any sms has been seen`() {
        assertFalse(dedupe.isDuplicateOfRecentSms("anything"))
        assertFalse(dedupe.isDuplicateOfRecentSms(""))
    }
}
