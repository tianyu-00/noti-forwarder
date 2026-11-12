package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceStreamRunnerTest {
    private val store = InMemoryTokenStore(Credentials("https://nf.example.com", "dev-1", "tok"))
    private var revoked = 0
    private val sleeps = mutableListOf<Long>()

    // Plays the given outcomes one by one; the loop must not ask for more than it was given.
    private fun runner(vararg ends: StreamEnd, stopAfter: Int = ends.size): DeviceStreamRunner {
        val queue = ends.toMutableList()
        var runs = 0
        return DeviceStreamRunner(
            connect = { queue.removeAt(0).also { runs++ } },
            store = store,
            onRevoked = { revoked++ },
            // Fixed delays, so the test can see them: 2 s, 4 s, 8 s ... capped at 60 s.
            backoff = Backoff(baseMillis = 2_000, maxMillis = 60_000, jitter = 0.0),
            sleep = { sleeps += it },
            isStopped = { runs >= stopAfter },
        )
    }

    @Test
    fun `reconnects after a drop, waiting longer while the server stays unreachable`() {
        runner(
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false), // the run ends here, so this one does not wait
        ).run()

        assertEquals(listOf(2_000L, 4_000L, 8_000L), sleeps)
    }

    @Test
    fun `starts the wait over after a connection that held`() {
        runner(
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = true),
            StreamEnd.Dropped(wasConnected = false), // the run ends here, so this one does not wait
        ).run()

        assertEquals(listOf(2_000L, 4_000L, 2_000L), sleeps)
    }

    @Test
    fun `a revoked phone forgets its credentials, tells the app and stops`() {
        runner(StreamEnd.Revoked, stopAfter = 99).run()

        assertNull(store.load())
        assertEquals(1, revoked)
        assertEquals(emptyList<Long>(), sleeps)
    }

    @Test
    fun `stops quietly when the phone is not paired`() {
        runner(StreamEnd.NotPaired, stopAfter = 99).run()

        assertEquals(0, revoked)
        assertEquals(emptyList<Long>(), sleeps)
    }
}
