package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoStartTest {
    @Test
    fun `OnePlus, Oppo and Realme phones are told the two taps that reach the switch`() {
        for (maker in listOf("OnePlus", "OPPO", "realme", "oneplus")) {
            val help = autoStartHelp(maker)
            assertTrue(maker, "Battery usage" in help)
            assertTrue(maker, "Allow auto-launch" in help)
        }
    }

    @Test
    fun `other makers get a general hint, not OnePlus wording`() {
        for (maker in listOf("samsung", "")) {
            val help = autoStartHelp(maker)
            assertTrue(maker, help.isNotBlank())
            assertFalse(maker, "Allow auto-launch" in help)
        }
    }
}
