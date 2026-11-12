package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackoffTest {
    private val second = 1_000L
    private val minute = 60 * second

    // random = 0.5 means "no jitter", so the exact doubling is visible.
    private val exact = Backoff(baseMillis = 15 * second, maxMillis = 15 * minute, jitter = 0.2, random = { 0.5 })

    @Test
    fun `doubles with each attempt`() {
        assertEquals(15 * second, exact.delayMillis(1))
        assertEquals(30 * second, exact.delayMillis(2))
        assertEquals(60 * second, exact.delayMillis(3))
        assertEquals(120 * second, exact.delayMillis(4))
    }

    @Test
    fun `never waits longer than the cap, even after a very long outage`() {
        assertEquals(15 * minute, exact.delayMillis(20))
        assertEquals(15 * minute, exact.delayMillis(10_000))
    }

    @Test
    fun `jitter keeps the delay within 20 percent either way`() {
        val low = Backoff(15 * second, 15 * minute, 0.2) { 0.0 }.delayMillis(3)
        val high = Backoff(15 * second, 15 * minute, 0.2) { 1.0 }.delayMillis(3)

        assertEquals((60 * second * 0.8).toLong(), low)
        assertEquals((60 * second * 1.2).toLong(), high)
        assertTrue(low < exact.delayMillis(3) && exact.delayMillis(3) < high)
    }

    @Test
    fun `jitter can never push a delay past the cap`() {
        val high = Backoff(15 * second, 15 * minute, 0.2) { 1.0 }

        assertEquals(15 * minute, high.delayMillis(30))
    }

    @Test
    fun `treats a first or nonsensical attempt number as the first retry`() {
        assertEquals(exact.delayMillis(1), exact.delayMillis(0))
        assertEquals(exact.delayMillis(1), exact.delayMillis(-5))
    }
}
