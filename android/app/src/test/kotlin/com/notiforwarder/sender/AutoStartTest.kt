package com.notiforwarder.sender

import org.junit.Assert.assertTrue
import org.junit.Test

class AutoStartTest {
    @Test
    fun `OnePlus, Oppo and Realme phones have a page of their own to try`() {
        for (maker in listOf("OnePlus", "OPPO", "realme", "oneplus")) {
            assertTrue(maker, autoStartPages(maker).isNotEmpty())
        }
    }

    @Test
    fun `other makers have none, so the app's own settings page is used`() {
        assertTrue(autoStartPages("samsung").isEmpty())
        assertTrue(autoStartPages("").isEmpty())
    }
}
