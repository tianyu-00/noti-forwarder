package com.notiforwarder.sender

import java.io.IOException
import java.time.OffsetDateTime
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
    /** The name the user knows an app by, from its package name; null when it cannot be found. */
    private val appLabel: (String) -> String? = { null },
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
) : BatchSender {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * With an encryption key, sender and text are encrypted just before they leave the phone (the
     * queue keeps the plain text on the phone). The same message always gives the same bytes, so a
     * retry is identical. App, type, id and time stay readable so the server can still filter.
     */
    private fun encryptIfKeyed(messages: List<Message>, key: String?): List<Message> {
        if (key == null) return messages
        val cipher = E2eCipher(key)
        return messages.map { m ->
            val at = OffsetDateTime.parse(m.receivedAt).toInstant().toEpochMilli()
            m.copy(
                sender = if (m.sender.isEmpty()) "" else cipher.encrypt("sender", m.sender, m.app, at),
                body = cipher.encrypt("body", m.body, m.app, at),
            )
        }
    }

    /**
     * Notifications carry the real app name next to the package name (the server only sees
     * "com.google.android.gm"). Looked up now, not when captured, so the queue is unchanged. It is
     * not secret, so it stays readable when the text is encrypted.
     */
    private fun withAppLabels(messages: List<Message>): List<Message> = messages.map { m ->
        if (m.type != "notification" || m.appLabel != null) m else m.copy(appLabel = appLabel(m.app))
    }

    override fun send(messages: List<Message>): SendOutcome {
        val credentials = store.load() ?: return SendOutcome.NotPaired
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/messages")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .post(json.encodeToString(SendRequest(encryptIfKeyed(withAppLabels(messages), credentials.e2eKey))).toRequestBody(JSON_MEDIA_TYPE))
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
