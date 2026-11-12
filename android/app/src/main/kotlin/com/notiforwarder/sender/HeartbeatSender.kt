package com.notiforwarder.sender

import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

sealed interface HeartbeatOutcome {
    data object Sent : HeartbeatOutcome
    data object NotPaired : HeartbeatOutcome

    /** The server revoked this phone; credentials are cleared. */
    data object Unauthorized : HeartbeatOutcome
    data class ServerError(val status: Int) : HeartbeatOutcome
    data class Unreachable(val reason: String) : HeartbeatOutcome
}

/**
 * Tells the server "this phone is alive", with no message attached. Without it a phone with
 * nothing to send looks the same as a phone whose app was killed. Blocking: call it off the main
 * thread.
 */
class HeartbeatSender(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttpClient(),
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
) {
    fun send(): HeartbeatOutcome {
        val credentials = store.load() ?: return HeartbeatOutcome.NotPaired
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/heartbeat")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .post(ByteArray(0).toRequestBody(null))
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                when (response.code) {
                    204 -> HeartbeatOutcome.Sent
                    401 -> {
                        store.clear()
                        onRevoked()
                        HeartbeatOutcome.Unauthorized
                    }
                    else -> HeartbeatOutcome.ServerError(response.code)
                }
            }
        } catch (e: IOException) {
            HeartbeatOutcome.Unreachable(e.message ?: "network error")
        }
    }
}
