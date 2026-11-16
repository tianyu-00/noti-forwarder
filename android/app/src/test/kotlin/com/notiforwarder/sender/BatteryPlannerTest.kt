package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BatteryPlannerTest {
    private val on = ReceiverSettings()

    @Test
    fun `a low battery names the phone and the level, and says what to do`() {
        val plan = BatteryPlanner.low("d1", "Kitchen phone", 14, on)!!

        assertEquals("Kitchen phone battery is low", plan.title)
        assertEquals("14% left and it is not charging. Plug it in so it keeps forwarding.", plan.text)
    }

    @Test
    fun `a phone with no name is called Phone`() {
        assertEquals("Phone battery is low", BatteryPlanner.low("d1", null, 10, on)!!.title)
    }

    @Test
    fun `each phone has its own notice, apart from its quiet notice`() {
        assertNotEquals(BatteryPlanner.keyFor("d1"), BatteryPlanner.keyFor("d2"))
        assertNotEquals(BatteryPlanner.keyFor("d1"), QuietPlanner.keyFor("d1"))
    }

    @Test
    fun `nothing is shown when alerts are off, or when low-battery alerts are off`() {
        assertNull(BatteryPlanner.low("d", "P", 10, on.copy(enabled = false)))
        assertNull(BatteryPlanner.low("d", "P", 10, on.copy(batteryAlerts = false)))
    }

    @Test
    fun `low-battery alerts are on by default, whatever the message mode`() {
        assertEquals(true, ReceiverSettings().batteryAlerts)
        assertEquals("P battery is low", BatteryPlanner.low("d", "P", 10, on.copy(mode = AlertMode.CodesOnly))!!.title)
    }

    @Test
    fun `describes a level for the list`() {
        assertEquals("63%", BatteryPlanner.describe(BatteryReading(63, false)))
        assertEquals("63%, charging", BatteryPlanner.describe(BatteryReading(63, true)))
    }

    @Test
    fun `a level is low at 15 or less while not charging, the same limit the server alerts at`() {
        assertEquals(true, BatteryPlanner.isLow(BatteryReading(15, false)))
        assertEquals(false, BatteryPlanner.isLow(BatteryReading(16, false)))
        assertEquals(false, BatteryPlanner.isLow(BatteryReading(5, true)))
    }
}
