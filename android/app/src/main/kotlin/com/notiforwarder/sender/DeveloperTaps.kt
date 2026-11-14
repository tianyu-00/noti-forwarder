package com.notiforwarder.sender

sealed interface TapResult {
    data object Nothing : TapResult
    data class Remaining(val taps: Int) : TapResult
    data object Unlocked : TapResult
}

/**
 * Counts quick taps on the version number, the way Android's own "Build number" unlocks developer
 * options. A pause longer than [gapMs] starts the count again. Says nothing for the first taps, then
 * counts down the last three.
 */
class DeveloperTaps(private val needed: Int = 7, private val gapMs: Long = 2_000) {
    private var count = 0
    private var last = Long.MIN_VALUE

    fun tap(now: Long): TapResult {
        count = if (last != Long.MIN_VALUE && now - last > gapMs) 1 else count + 1
        last = now
        val left = needed - count
        return when {
            left <= 0 -> { count = 0; TapResult.Unlocked }
            left <= 3 -> TapResult.Remaining(left)
            else -> TapResult.Nothing
        }
    }
}
