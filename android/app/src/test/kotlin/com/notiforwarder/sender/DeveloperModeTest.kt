package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeveloperModeTest {
    @Test
    fun `turning developer mode on leaves practice mode off`() {
        val on = withDeveloperMode(CaptureSettings(), true)

        assertTrue(on.developerMode)
        assertFalse(on.practiceReplies)
    }

    @Test
    fun `turning developer mode off also turns practice mode off, so it is never left on out of sight`() {
        val off = withDeveloperMode(CaptureSettings(developerMode = true, practiceReplies = true), false)

        assertFalse(off.developerMode)
        assertFalse(off.practiceReplies)
    }

    @Test
    fun `turning developer mode off changes nothing else`() {
        val before = CaptureSettings(developerMode = true, allowReplies = true, allowedSims = setOf(5))

        val after = withDeveloperMode(before, false)

        assertTrue(after.allowReplies)
        assertTrue(after.allowedSims == setOf(5))
    }
}
