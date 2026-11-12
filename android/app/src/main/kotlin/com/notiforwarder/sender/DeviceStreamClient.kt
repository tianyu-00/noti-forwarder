package com.notiforwarder.sender

import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/** Why the phone's connection to the server ended. */
sealed interface StreamEnd {
    data object NotPaired : StreamEnd

    /** The server said this phone was revoked or unpaired (a message, or a rejected token). */
    data object Revoked : StreamEnd

    /** Lost or refused. [wasConnected] says whether it had been up, which resets the retry wait. */
    data class Dropped(val wasConnected: Boolean) : StreamEnd
}

/**
 * Holds one open connection to the server (the same mechanism as the dashboard's live stream).
 * While it is open the dashboard shows this phone as connected, and the server can tell the
 * phone at once that it was revoked. Blocking: run it on its own thread, and call [cancel] to
 * stop it.
 */
class DeviceStreamClient(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = streamHttpClient(),
    /**
     * A small check-in sent while the connection is open. A phone that loses its network never
     * closes the connection, and the server cannot tell from its side for many minutes, so the
     * phone proves it is alive and the server drops it after a minute of silence.
     */
    private val beat: () -> Unit = {},
    private val beatIntervalMs: Long = 25_000,
) {
    @Volatile private var call: Call? = null

    /** [onConnected] is called once the server accepts the connection (not for a refusal). */
    fun run(onConnected: () -> Unit = {}): StreamEnd {
        val credentials = store.load() ?: return StreamEnd.NotPaired
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/device-stream")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .header("Accept", "text/event-stream")
            .build()
        val newCall = http.newCall(request)
        call = newCall
        return try {
            newCall.execute().use { response ->
                when {
                    response.code == 401 -> StreamEnd.Revoked
                    !response.isSuccessful -> StreamEnd.Dropped(wasConnected = false)
                    else -> {
                        onConnected()
                        val timer = startBeating()
                        try {
                            readEvents(response.body.source())
                        } finally {
                            timer.shutdownNow()
                        }
                    }
                }
            }
        } catch (e: IOException) {
            // A cancelled or broken connection. If it was up, the retry wait starts over.
            StreamEnd.Dropped(wasConnected = false)
        } finally {
            call = null
        }
    }

    // Runs only while connected. A failed check-in is ignored: the next one tries again, and a
    // dead connection ends the read anyway.
    private fun startBeating(): ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "device-stream-beat").apply { isDaemon = true } }
            .also { timer ->
                timer.scheduleWithFixedDelay(
                    { runCatching { beat() } },
                    beatIntervalMs, beatIntervalMs, TimeUnit.MILLISECONDS,
                )
            }

    fun cancel() {
        call?.cancel()
    }

    // Server-sent events: lines of "event: name" and "data: ...", frames end with a blank line,
    // and lines starting with ":" are pings. Only "revoked" matters; the rest is ignored.
    private fun readEvents(source: okio.BufferedSource): StreamEnd {
        var event: String? = null
        try {
            while (true) {
                val line = source.readUtf8Line() ?: return StreamEnd.Dropped(wasConnected = true)
                when {
                    line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                    line.isEmpty() -> {
                        if (event == "revoked") return StreamEnd.Revoked
                        event = null
                    }
                }
            }
        } catch (e: IOException) {
            return StreamEnd.Dropped(wasConnected = true)
        }
    }
}
