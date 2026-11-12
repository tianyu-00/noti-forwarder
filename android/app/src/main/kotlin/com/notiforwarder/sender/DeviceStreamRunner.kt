package com.notiforwarder.sender

import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * Keeps the phone's connection to the server open: reconnects after a drop with a growing wait,
 * and stops for good when the server says the phone was revoked. [wake] cuts the wait short,
 * e.g. when Android reports the network is back, so a phone does not sit out a minute-long wait
 * after a reboot or airplane mode. The loop in [run] is plain Kotlin so it is tested on the JVM;
 * [start] and [stop] only manage its thread.
 */
class DeviceStreamRunner(
    private val connect: () -> StreamEnd,
    private val store: TokenStore,
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
    private val backoff: Backoff = Backoff(baseMillis = 2_000, maxMillis = 60_000),
    /** Waits up to the given time. Returns true if it was cut short by [wake]. Tests replace it. */
    wait: ((Long) -> Boolean)? = null,
    private val now: () -> Long = System::currentTimeMillis,
    private val isStopped: () -> Boolean = { false },
    /** Closes the connection that is open now, so the loop can end. */
    private val cancel: () -> Unit = {},
) {
    @Volatile private var stopRequested = false
    @Volatile private var waiting = false
    private val gate = Semaphore(0)
    private var thread: Thread? = null

    private val doWait: (Long) -> Boolean = wait ?: { millis ->
        gate.drainPermits() // a wake that arrived while nobody was waiting must not count
        waiting = true
        try {
            gate.tryAcquire(millis, TimeUnit.MILLISECONDS)
        } finally {
            waiting = false
        }
    }

    private fun stopped() = stopRequested || isStopped()

    fun run() {
        var attempt = 0
        var lastAttemptAt: Long? = null
        try {
            while (!stopped()) {
                // However often the network flaps, never try twice within MIN_GAP_MILLIS.
                lastAttemptAt?.let { last ->
                    var gap = MIN_GAP_MILLIS - (now() - last)
                    while (gap > 0 && !stopped()) {
                        doWait(gap)
                        gap = MIN_GAP_MILLIS - (now() - last)
                    }
                    if (stopped()) return
                }
                lastAttemptAt = now()
                when (val end = connect()) {
                    StreamEnd.NotPaired -> return
                    StreamEnd.Revoked -> {
                        store.clear()
                        onRevoked()
                        return
                    }
                    is StreamEnd.Dropped -> {
                        if (stopped()) return
                        attempt = if (end.wasConnected) 1 else attempt + 1
                        val woken = doWait(backoff.delayMillis(attempt))
                        // The network just came back, so the server is worth trying fresh.
                        if (woken) attempt = 0
                    }
                }
            }
        } catch (e: InterruptedException) {
            // stop() interrupted a wait
        }
    }

    /** The network may be back: end the current wait and try again now. Does nothing if not waiting. */
    fun wake() {
        if (waiting) gate.release()
    }

    /** Safe to call again while it is already running. */
    @Synchronized
    fun start() {
        if (thread?.isAlive == true) return
        stopRequested = false
        thread = Thread(::run, "device-stream").apply {
            isDaemon = true
            start()
        }
    }

    @Synchronized
    fun stop() {
        stopRequested = true
        cancel()
        thread?.interrupt()
    }

    private companion object {
        const val MIN_GAP_MILLIS = 2_000L
    }
}
