package com.notiforwarder.sender

import kotlin.random.Random

/**
 * How long to wait before retrying a failed send: doubles each attempt up to a cap,
 * with a little random jitter so many phones do not retry in lockstep.
 */
class Backoff(
    private val baseMillis: Long = 15_000,
    private val maxMillis: Long = 15 * 60_000,
    private val jitter: Double = 0.2,
    private val random: () -> Double = { Random.nextDouble() },
) {
    /** [attempt] is 1 for the first retry. */
    fun delayMillis(attempt: Int): Long {
        val doublings = (attempt - 1).coerceIn(0, 30) // 30 keeps the shift far from overflow
        val exponential = (baseMillis shl doublings).coerceAtMost(maxMillis)
        val factor = 1 + (random() * 2 - 1) * jitter
        return (exponential * factor).toLong().coerceAtMost(maxMillis)
    }
}
