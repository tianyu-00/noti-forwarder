package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoStartTest {
    @Test
    fun `says what to turn on`() {
        val help = autoStartHelp().lowercase()

        assertTrue("turn on auto-launch" in help)
        assertTrue("allow background activity" in help)
    }

    @Test
    fun `says the steps differ from phone to phone`() {
        assertTrue("differ" in autoStartHelp())
    }

    @Test
    fun `does not say where to find it, which varies and may not be in the app's settings`() {
        val help = autoStartHelp()

        assertFalse("OnePlus" in help)
        assertFalse("Battery usage" in help)
        assertFalse("settings" in help.lowercase())
    }
}
