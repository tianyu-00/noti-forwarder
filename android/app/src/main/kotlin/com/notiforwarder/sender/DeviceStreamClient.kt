package com.notiforwarder.sender

import java.io.IOException
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
) {
    @Volatile private var call: Call? = null

    fun run(): StreamEnd {
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
                    else -> readEvents(response.body.source())
                }
            }
        } catch (e: IOException) {
            // A cancelled or broken connection. If it was up, the retry wait starts over.
            StreamEnd.Dropped(wasConnected = false)
        } finally {
            call = null
        }
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
