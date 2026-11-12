package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceStreamRunnerTest {
    private val store = InMemoryTokenStore(Credentials("https://nf.example.com", "dev-1", "tok"))
    private var revoked = 0
    private val sleeps = mutableListOf<Long>()
    private var clock = 0L

    // Plays the given outcomes one by one; the loop must not ask for more than it was given.
    // Waits are instant: they only advance a fake clock. A wait listed in [wokenWaits] (1 = the
    // first) is cut short after 100 ms, as if the network had just come back.
    private fun runner(
        vararg ends: StreamEnd,
        stopAfter: Int = ends.size,
        wokenWaits: Set<Int> = emptySet(),
    ): DeviceStreamRunner {
        val queue = ends.toMutableList()
        var runs = 0
        var waits = 0
        return DeviceStreamRunner(
            connect = { queue.removeAt(0).also { runs++ } },
            store = store,
            onRevoked = { revoked++ },
            // Fixed delays, so the test can see them: 2 s, 4 s, 8 s ... capped at 60 s.
            backoff = Backoff(baseMillis = 2_000, maxMillis = 60_000, jitter = 0.0),
            wait = { ms ->
                waits++
                sleeps += ms
                val woken = waits in wokenWaits
                clock += if (woken) 100 else ms
                woken
            },
            now = { clock },
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

    @Test
    fun `when the network comes back the wait ends early and the next wait starts over`() {
        // Drop, a wait that the network cut short, a drop again, then a fresh wait: 2 s, not 4 s.
        runner(
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false), // the run ends here
            wokenWaits = setOf(1),
        ).run()

        // 2000 (woken after 100 ms), then 1900 more so two attempts are never under 2 s apart,
        // then the next wait starts at 2000 again.
        assertEquals(listOf(2_000L, 1_900L, 2_000L), sleeps)
    }

    @Test
    fun `wakes cannot make it retry more than once every two seconds`() {
        runner(
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            StreamEnd.Dropped(wasConnected = false),
            wokenWaits = setOf(1, 3),
        ).run()

        // Every wake is followed by a pause that makes up the rest of the 2 seconds.
        assertTrue(sleeps.contains(1_900L))
        assertEquals(1_900L, sleeps.filter { it < 2_000L }.first())
    }

    @Test
    fun `a real wake ends a long wait at once`() {
        var runs = 0
        val runner = DeviceStreamRunner(
            connect = { if (runs++ == 0) StreamEnd.Dropped(wasConnected = false) else StreamEnd.Revoked },
            store = store,
            onRevoked = { revoked++ },
            backoff = Backoff(baseMillis = 20_000, maxMillis = 20_000, jitter = 0.0),
        )
        val started = System.nanoTime()
        val thread = Thread(runner::run).also { it.start() }
        Thread.sleep(200)

        runner.wake()
        thread.join(10_000)

        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(1, revoked)
        assertTrue("took $elapsedMs ms, a 20 s wait should have been cut short", elapsedMs < 5_000)
    }

    @Test
    fun `a wake while it is not waiting does nothing`() {
        var runs = 0
        val runner = DeviceStreamRunner(
            connect = { if (runs++ == 0) StreamEnd.Dropped(wasConnected = false) else StreamEnd.Revoked },
            store = store,
            onRevoked = { revoked++ },
            backoff = Backoff(baseMillis = 500, maxMillis = 500, jitter = 0.0),
        )
        runner.wake() // nobody is waiting: must not leave a stray permit behind

        val started = System.nanoTime()
        runner.run()

        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("retried after only $elapsedMs ms, the 500 ms wait was skipped", elapsedMs >= 400)
    }
}
