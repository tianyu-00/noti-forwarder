package com.notiforwarder.sender

/**
 * Keeps the phone's connection to the server open: reconnects after a drop with a growing wait,
 * and stops for good when the server says the phone was revoked. The loop in [run] is plain
 * Kotlin so it is tested on the JVM; [start] and [stop] only manage its thread.
 */
class DeviceStreamRunner(
    private val connect: () -> StreamEnd,
    private val store: TokenStore,
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
    private val backoff: Backoff = Backoff(baseMillis = 2_000, maxMillis = 60_000),
    private val sleep: (Long) -> Unit = Thread::sleep,
    private val isStopped: () -> Boolean = { false },
    /** Closes the connection that is open now, so the loop can end. */
    private val cancel: () -> Unit = {},
) {
    @Volatile private var stopRequested = false
    private var thread: Thread? = null

    fun run() {
        var attempt = 0
        while (!stopRequested && !isStopped()) {
            when (val end = connect()) {
                StreamEnd.NotPaired -> return
                StreamEnd.Revoked -> {
                    store.clear()
                    onRevoked()
                    return
                }
                is StreamEnd.Dropped -> {
                    if (stopRequested || isStopped()) return
                    attempt = if (end.wasConnected) 1 else attempt + 1
                    try {
                        sleep(backoff.delayMillis(attempt))
                    } catch (e: InterruptedException) {
                        return
                    }
                }
            }
        }
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
}
