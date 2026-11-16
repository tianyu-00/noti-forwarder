package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverChecksTest {
    private val allGood = Readiness(accessGranted = false, notificationsAllowed = true, batteryExempt = true, smsAllowed = false)

    private fun check(kind: RunningCheck.Kind, ready: Readiness = allGood) =
        receiverChecks(ready).single { it.kind == kind }

    @Test
    fun `a receiver lists notifications, battery and auto-start, in that order, whatever is allowed`() {
        val order = listOf(RunningCheck.Kind.PostNotifications, RunningCheck.Kind.Battery, RunningCheck.Kind.AutoStart)

        assertEquals(order, receiverChecks(allGood).map { it.kind })
        assertEquals(order, receiverChecks(Readiness(false, false, false, false)).map { it.kind })
    }

    @Test
    fun `a receiver never asks for notification access or the SMS permission, which only a sender needs`() {
        val kinds = receiverChecks(Readiness(false, false, false, false)).map { it.kind }

        assertFalse(RunningCheck.Kind.NotificationAccess in kinds)
        assertFalse(RunningCheck.Kind.Sms in kinds)
    }

    @Test
    fun `notifications are fine once allowed, and otherwise say why they matter and offer to allow them`() {
        val ok = check(RunningCheck.Kind.PostNotifications)
        assertTrue(ok.ok)
        assertEquals("Notifications are allowed", ok.text)
        assertNull(ok.action)

        val off = check(RunningCheck.Kind.PostNotifications, Readiness(false, false, true, false))
        assertFalse(off.ok)
        assertEquals("Allow notifications", off.text)
        assertEquals("Allow", off.action)
        assertEquals("Without it, alerts cannot show on this phone", off.detail)
    }

    @Test
    fun `battery optimisation is fine once off, and otherwise says alerts may be late`() {
        assertEquals("Battery optimisation is off", check(RunningCheck.Kind.Battery).text)

        val on = check(RunningCheck.Kind.Battery, Readiness(false, true, false, false))
        assertFalse(on.ok)
        assertEquals("Battery optimisation is on", on.text)
        assertEquals("Turn off", on.action)
        assertEquals("Alerts may arrive late, or not at all, when the screen is off", on.detail)
    }

    @Test
    fun `auto-start always asks the user to check, because Android cannot say`() {
        val auto = check(RunningCheck.Kind.AutoStart)

        assertEquals("Auto-start", auto.text)
        assertFalse(auto.ok)
        assertEquals("Open", auto.action)
        assertEquals(autoStartHelp(), auto.detail)
    }
}
