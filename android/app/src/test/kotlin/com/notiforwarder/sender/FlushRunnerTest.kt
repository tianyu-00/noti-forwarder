package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class FlushRunnerTest {
    private class FakeScheduler : FlushScheduler {
        val calls = mutableListOf<String>()
        override fun flushSoon() {
            calls += "soon"
        }
        override fun flushAfter(delayMillis: Long) {
            calls += "after $delayMillis"
        }
    }

    private val scheduler = FakeScheduler()

    private fun runner(result: () -> FlushResult) = FlushRunner({ result() }, scheduler)

    @Test
    fun `schedules nothing once everything is sent`() {
        runner { FlushResult.Drained }.run()

        assertEquals(emptyList<String>(), scheduler.calls)
    }

    @Test
    fun `schedules the retry after the backoff the flusher asked for`() {
        runner { FlushResult.RetryAfter(30_000) }.run()

        assertEquals(listOf("after 30000"), scheduler.calls)
    }

    @Test
    fun `does not retry when the phone is revoked or not paired`() {
        runner { FlushResult.Blocked }.run()

        assertEquals(emptyList<String>(), scheduler.calls)
    }

    @Test
    fun `an unexpected crash still schedules a retry instead of losing the work`() {
        runner { error("boom") }.run()

        assertEquals(listOf("after 60000"), scheduler.calls)
    }
}
