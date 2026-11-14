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

/** Developer mode shows testing tools like practice mode. Switching it off also switches them off, so none stays on unseen. */
fun withDeveloperMode(settings: CaptureSettings, on: Boolean) =
    settings.copy(developerMode = on, practiceReplies = settings.practiceReplies && on)
