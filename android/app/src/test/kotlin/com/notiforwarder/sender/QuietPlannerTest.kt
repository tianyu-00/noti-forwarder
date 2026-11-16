package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuietPlannerTest {
    private val on = ReceiverSettings()

    @Test
    fun `a phone that went quiet names itself and says for how long`() {
        val plan = QuietPlanner.quiet("d1", "Kitchen phone", 180, on)!!

        assertEquals("Kitchen phone has gone quiet", plan.title)
        assertEquals("No contact for 3 hours. Check that the app is running and Notification access is on.", plan.text)
    }

    @Test
    fun `short and singular durations read naturally`() {
        assertEquals("No contact for 45 minutes.", QuietPlanner.quiet("d", "P", 45, on)!!.text.substringBefore(" Check"))
        assertEquals("No contact for 1 hour.", QuietPlanner.quiet("d", "P", 60, on)!!.text.substringBefore(" Check"))
        assertEquals("No contact for 1 minute.", QuietPlanner.quiet("d", "P", 1, on)!!.text.substringBefore(" Check"))
        assertEquals("No contact for 2 days.", QuietPlanner.quiet("d", "P", 2 * 24 * 60 + 30, on)!!.text.substringBefore(" Check"))
    }

    @Test
    fun `a phone with no name is called Phone`() {
        assertEquals("Phone has gone quiet", QuietPlanner.quiet("d1", null, 120, on)!!.title)
        assertEquals("Phone is back", QuietPlanner.back("d1", null, on)!!.title)
    }

    @Test
    fun `back replaces the quiet notice, so both use the same key`() {
        val quiet = QuietPlanner.quiet("d1", "Kitchen phone", 180, on)!!
        val back = QuietPlanner.back("d1", "Kitchen phone", on)!!

        assertEquals(quiet.key, back.key)
        assertEquals("Kitchen phone is back", back.title)
        assertEquals("It is checking in again.", back.text)
    }

    @Test
    fun `different phones have different keys`() {
        assertNotEquals(QuietPlanner.keyFor("d1"), QuietPlanner.keyFor("d2"))
    }

    @Test
    fun `nothing is shown when alerts are off, or when quiet-phone alerts are off`() {
        assertNull(QuietPlanner.quiet("d", "P", 180, on.copy(enabled = false)))
        assertNull(QuietPlanner.quiet("d", "P", 180, on.copy(quietAlerts = false)))
        assertNull(QuietPlanner.back("d", "P", on.copy(enabled = false)))
        assertNull(QuietPlanner.back("d", "P", on.copy(quietAlerts = false)))
    }

    @Test
    fun `quiet-phone alerts are on by default, whatever the message mode`() {
        assertEquals(true, ReceiverSettings().quietAlerts)
        assertEquals("Kitchen has gone quiet", QuietPlanner.quiet("d", "Kitchen", 120, on.copy(mode = AlertMode.CodesOnly))!!.title)
    }
}
