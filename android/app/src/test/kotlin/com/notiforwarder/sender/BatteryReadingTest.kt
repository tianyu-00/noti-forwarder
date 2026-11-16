package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BatteryReadingTest {
    private val charging = 2 // BatteryManager.BATTERY_STATUS_CHARGING
    private val full = 5 // BATTERY_STATUS_FULL
    private val discharging = 3 // BATTERY_STATUS_DISCHARGING
    private val notCharging = 4 // BATTERY_STATUS_NOT_CHARGING

    @Test
    fun `turns the level and scale Android reports into a whole percent`() {
        assertEquals(BatteryReading(63, false), BatteryReading.from(level = 63, scale = 100, status = discharging))
        assertEquals(BatteryReading(50, false), BatteryReading.from(level = 127, scale = 255, status = discharging))
    }

    @Test
    fun `charging and full both count as plugged in, discharging and not charging do not`() {
        assertEquals(true, BatteryReading.from(40, 100, charging)!!.charging)
        assertEquals(true, BatteryReading.from(100, 100, full)!!.charging)
        assertEquals(false, BatteryReading.from(40, 100, discharging)!!.charging)
        assertEquals(false, BatteryReading.from(40, 100, notCharging)!!.charging)
    }

    @Test
    fun `no reading when Android gives nothing usable`() {
        assertNull(BatteryReading.from(level = -1, scale = 100, status = charging))
        assertNull(BatteryReading.from(level = 50, scale = -1, status = charging))
        assertNull(BatteryReading.from(level = 50, scale = 0, status = charging))
    }

    @Test
    fun `a level outside 0 to 100 is clamped, never sent as is`() {
        assertEquals(100, BatteryReading.from(level = 120, scale = 100, status = charging)!!.percent)
        assertEquals(0, BatteryReading.from(level = 0, scale = 100, status = discharging)!!.percent)
    }
}
