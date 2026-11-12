package com.notiforwarder.sender

/** Asks the system to run a flush; the real one uses WorkManager. */
interface FlushScheduler {
    /** Flush as soon as there is a network connection. */
    fun flushSoon()

    /** Flush after a delay, and only with a network connection. */
    fun flushAfter(delayMillis: Long)
}

/** One scheduled flush: run it, then schedule whatever should happen next. */
class FlushRunner(
    private val flush: () -> FlushResult,
    private val scheduler: FlushScheduler,
) {
    fun run() {
        try {
            when (val result = flush()) {
                is FlushResult.RetryAfter -> scheduler.flushAfter(result.delayMillis)
                FlushResult.Drained, FlushResult.Blocked -> Unit // blocked resumes when pairing changes
            }
        } catch (e: Exception) {
            // The queue is untouched, so just try again later.
            scheduler.flushAfter(UNEXPECTED_ERROR_RETRY_MILLIS)
        }
    }

    private companion object {
        const val UNEXPECTED_ERROR_RETRY_MILLIS = 60_000L
    }
}
