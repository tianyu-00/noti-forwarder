package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TabsTest {
    @Test
    fun `a paired phone has the tabs in this order`() {
        assertEquals(
            listOf(Tab.Status, Tab.Forward, Tab.Activity, Tab.Settings),
            visibleTabs(paired = true),
        )
    }

    @Test
    fun `an unpaired phone has no tabs, only the pairing screen`() {
        assertTrue(visibleTabs(paired = false).isEmpty())
    }

    @Test
    fun `each tab has the name shown under its icon`() {
        assertEquals(
            listOf("Status", "Forward", "Activity", "Settings"),
            visibleTabs(paired = true).map { it.label },
        )
    }

    @Test
    fun `stays on the chosen tab while paired`() {
        assertEquals(Tab.Forward, currentTab(Tab.Forward, paired = true))
    }

    @Test
    fun `goes back to Status after unpairing and pairing again`() {
        assertEquals(Tab.Status, currentTab(Tab.Settings, paired = false))
    }
}
