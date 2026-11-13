package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoStartTest {
    @Test
    fun `says the steps differ from phone to phone`() {
        assertTrue("differ" in autoStartHelp())
    }

    @Test
    fun `points at what to look for in the app's settings`() {
        val help = autoStartHelp()

        assertTrue("auto-launch" in help.lowercase())
        assertTrue("background" in help.lowercase())
    }

    @Test
    fun `does not name one maker's menus`() {
        assertFalse("OnePlus" in autoStartHelp())
        assertFalse("Battery usage" in autoStartHelp())
    }
}
