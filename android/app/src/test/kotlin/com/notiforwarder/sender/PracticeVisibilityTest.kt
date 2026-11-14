package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PracticeVisibilityTest {
    @Test
    fun `practice mode is hidden by default`() {
        assertFalse(showPracticeMode(CaptureSettings()))
    }

    @Test
    fun `developer mode shows it`() {
        assertTrue(showPracticeMode(CaptureSettings(developerMode = true)))
    }

    @Test
    fun `turning developer mode off hides it again`() {
        val on = CaptureSettings(developerMode = true)

        assertFalse(showPracticeMode(on.copy(developerMode = false)))
    }

    @Test
    fun `it stays visible while practice mode is still on, so it is never left on out of sight`() {
        assertTrue(showPracticeMode(CaptureSettings(developerMode = false, practiceReplies = true)))
    }
}
