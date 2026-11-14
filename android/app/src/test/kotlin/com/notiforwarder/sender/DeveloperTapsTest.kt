package com.notiforwarder.sender

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeveloperTapsTest {
    private fun taps() = DeveloperTaps(needed = 7, gapMs = 2_000)

    @Test
    fun `taps before the seventh do not unlock`() {
        val t = taps()

        repeat(6) { assertFalse(t.tap(it * 100L)) }
    }

    @Test
    fun `the seventh quick tap unlocks`() {
        val t = taps()
        repeat(6) { t.tap(it * 100L) }

        assertTrue(t.tap(600))
    }

    @Test
    fun `a pause between taps starts the count again`() {
        val t = taps()
        repeat(6) { t.tap(it * 100L) }

        assertFalse(t.tap(10_000))
        repeat(5) { assertFalse(t.tap(10_100L + it * 100)) }
        assertTrue(t.tap(10_600))
    }

    @Test
    fun `the count starts again after unlocking`() {
        val t = taps()
        repeat(7) { t.tap(it * 100L) }

        assertFalse(t.tap(700))
    }
}
