package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class DeveloperTapsTest {
    private fun taps() = DeveloperTaps(needed = 7, gapMs = 2_000)

    @Test
    fun `the first taps say nothing`() {
        val t = taps()
        assertEquals(TapResult.Nothing, t.tap(0))
        assertEquals(TapResult.Nothing, t.tap(100))
    }

    @Test
    fun `the last few taps count down`() {
        val t = taps()
        repeat(3) { t.tap(it * 100L) }

        assertEquals(TapResult.Remaining(3), t.tap(300))
        assertEquals(TapResult.Remaining(2), t.tap(400))
        assertEquals(TapResult.Remaining(1), t.tap(500))
    }

    @Test
    fun `the seventh quick tap unlocks`() {
        val t = taps()
        repeat(6) { t.tap(it * 100L) }

        assertEquals(TapResult.Unlocked, t.tap(600))
    }

    @Test
    fun `a pause between taps starts the count again`() {
        val t = taps()
        repeat(6) { t.tap(it * 100L) }

        assertEquals(TapResult.Nothing, t.tap(10_000))
        repeat(5) { t.tap(10_100L + it * 100) }
        assertEquals(TapResult.Unlocked, t.tap(10_600))
    }
}
