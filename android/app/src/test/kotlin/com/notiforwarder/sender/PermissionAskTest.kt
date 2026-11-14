package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class PermissionAskTest {
    @Test
    fun `the first time, ask with the system dialog`() {
        // Android also says "no rationale" before the first ask, so that alone must not mean "blocked".
        assertEquals(AskStep.Prompt, nextAskStep(askedBefore = false, canShowRationale = false))
    }

    @Test
    fun `after one refusal Android still shows the dialog`() {
        assertEquals(AskStep.Prompt, nextAskStep(askedBefore = true, canShowRationale = true))
    }

    @Test
    fun `once Android stops showing the dialog, send the user to the app's permission page`() {
        assertEquals(AskStep.OpenSettings, nextAskStep(askedBefore = true, canShowRationale = false))
    }
}
