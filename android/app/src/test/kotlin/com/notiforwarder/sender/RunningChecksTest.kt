package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RunningChecksTest {
    private val allGood = Readiness(
        accessGranted = true,
        notificationsAllowed = true,
        batteryExempt = true,
        smsAllowed = true,
    )

    private fun checks(ready: Readiness = allGood, settings: CaptureSettings = CaptureSettings()) =
        runningChecks(settings, ready)

    private fun check(kind: RunningCheck.Kind, ready: Readiness = allGood, settings: CaptureSettings = CaptureSettings()) =
        checks(ready, settings).single { it.kind == kind }

    @Test
    fun `lists every check in the same order, whatever is allowed`() {
        val order = listOf(
            RunningCheck.Kind.NotificationAccess,
            RunningCheck.Kind.Battery,
            RunningCheck.Kind.PostNotifications,
            RunningCheck.Kind.Sms,
            RunningCheck.Kind.AutoStart,
        )
        assertEquals(order, checks().map { it.kind })
        assertEquals(order, checks(Readiness(false, false, false, false)).map { it.kind })
    }

    @Test
    fun `a permission that is allowed stays in the list with a tick and no button`() {
        for (kind in listOf(RunningCheck.Kind.PostNotifications, RunningCheck.Kind.Sms)) {
            val row = check(kind)
            assertTrue(kind.name, row.ok)
            assertNull(kind.name, row.action)
        }
    }

    @Test
    fun `reading texts says so once it is allowed, and asks while it is not`() {
        assertEquals("Reading texts is allowed", check(RunningCheck.Kind.Sms).text)

        val asking = check(RunningCheck.Kind.Sms, allGood.copy(smsAllowed = false))
        assertEquals("Allow reading texts", asking.text)
        assertFalse(asking.ok)
        assertEquals("Allow", asking.action)
    }

    @Test
    fun `notifications are the same`() {
        assertEquals("Notifications are allowed", check(RunningCheck.Kind.PostNotifications).text)

        val asking = check(RunningCheck.Kind.PostNotifications, allGood.copy(notificationsAllowed = false))
        assertEquals("Allow notifications", asking.text)
        assertFalse(asking.ok)
        assertEquals("Allow", asking.action)
    }

    @Test
    fun `the texts row is left out when texts are not being forwarded`() {
        val kinds = checks(settings = CaptureSettings(sendSms = false)).map { it.kind }

        assertFalse(RunningCheck.Kind.Sms in kinds)
    }

    @Test
    fun `notification access and battery say what is wrong and offer the fix`() {
        val access = check(RunningCheck.Kind.NotificationAccess, allGood.copy(accessGranted = false))
        assertEquals("Notification access is off", access.text)
        assertEquals("Open", access.action)
        assertEquals("Notification access is on", check(RunningCheck.Kind.NotificationAccess).text)

        val battery = check(RunningCheck.Kind.Battery, allGood.copy(batteryExempt = false))
        assertEquals("Battery optimisation is on", battery.text)
        assertEquals("Turn off", battery.action)
        assertEquals("Battery optimisation is off", check(RunningCheck.Kind.Battery).text)
    }

    @Test
    fun `auto-start always asks the user to check, because Android cannot tell`() {
        val row = check(RunningCheck.Kind.AutoStart)

        assertFalse(row.ok)
        assertEquals("Open", row.action)
        assertEquals(autoStartHelp(), row.detail)
    }
}
