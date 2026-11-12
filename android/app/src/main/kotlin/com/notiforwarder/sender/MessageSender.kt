package com.notiforwarder.sender

import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

sealed interface SendOutcome {
    data class Sent(val stored: Int, val duplicates: Int) : SendOutcome
    data object NotPaired : SendOutcome

    /** The server revoked this phone; credentials are cleared. */
    data object Unauthorized : SendOutcome

    /** The server will never accept this payload, so retrying is pointless. */
    data object Rejected : SendOutcome
    data object RateLimited : SendOutcome
    data class ServerError(val status: Int) : SendOutcome
    data class Unreachable(val reason: String) : SendOutcome
}

@Serializable
private data class SendRequest(val messages: List<Message>)

@Serializable
private data class SendResponse(val stored: Int, val duplicates: Int)

/** Blocking: call it off the main thread. */
class MessageSender(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttpClient(),
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun send(messages: List<Message>): SendOutcome {
        val credentials = store.load() ?: return SendOutcome.NotPaired
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/messages")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .post(json.encodeToString(SendRequest(messages)).toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return try {
            http.newCall(request).execute().use { response ->
                when (response.code) {
                    201 -> {
                        val parsed = json.decodeFromString<SendResponse>(response.body.string())
                        SendOutcome.Sent(parsed.stored, parsed.duplicates)
                    }
                    401 -> {
                        store.clear()
                        onRevoked()
                        SendOutcome.Unauthorized
                    }
                    400, 413 -> SendOutcome.Rejected
                    429 -> SendOutcome.RateLimited
                    else -> SendOutcome.ServerError(response.code)
                }
            }
        } catch (e: IOException) {
            SendOutcome.Unreachable(e.message ?: "network error")
        }
    }
}
