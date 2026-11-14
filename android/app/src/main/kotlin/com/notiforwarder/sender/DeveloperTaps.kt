package com.notiforwarder.sender

/**
 * Counts quick taps on the version number, the way Android's own "Build number" unlocks developer
 * options. A pause longer than [gapMs] starts the count again. [tap] is true on the tap that unlocks.
 */
class DeveloperTaps(private val needed: Int = 7, private val gapMs: Long = 2_000) {
    private var count = 0
    private var last = Long.MIN_VALUE

    fun tap(now: Long): Boolean {
        count = if (last != Long.MIN_VALUE && now - last > gapMs) 1 else count + 1
        last = now
        if (count < needed) return false
        count = 0
        return true
    }
}

/** Practice mode is a testing tool: shown in developer mode, and while it is still on so it can be switched off. */
fun showPracticeMode(settings: CaptureSettings) = settings.developerMode || settings.practiceReplies
