package com.notiforwarder.sender

import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A reply typed on the dashboard, waiting to be sent as an SMS. Number and text may be encrypted. */
@Serializable
data class OutboxReply(val id: String, val to: String, val body: String, val sim: Int? = null)

@Serializable
private data class PendingResponse(val replies: List<OutboxReply>)

sealed interface PendingOutcome {
    data class Replies(val replies: List<OutboxReply>) : PendingOutcome
    data object NotPaired : PendingOutcome
    data object Unauthorized : PendingOutcome
    data class Failed(val reason: String) : PendingOutcome
}

sealed interface ReportOutcome {
    data object Reported : ReportOutcome
    data object NotPaired : ReportOutcome
    data object Unauthorized : ReportOutcome
    data class Failed(val reason: String) : ReportOutcome
}

/** What the reply logic needs from the server. A seam so the logic is tested without a network. */
interface OutboxApi {
    fun pending(): PendingOutcome
    fun report(id: String, sent: Boolean, error: String?): ReportOutcome
}

/** Blocking: call it off the main thread. */
class OutboxClient(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttpClient(),
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
) : OutboxApi {
    private val json = Json { ignoreUnknownKeys = true }

    private fun request(credentials: Credentials, path: String) = Request.Builder()
        .url("${credentials.serverUrl}/api/v1$path")
        .header("Authorization", "Bearer ${credentials.token}")
        .header("X-App-Version", appVersion)

    private fun revoked() {
        store.clear()
        onRevoked()
    }

    override fun pending(): PendingOutcome {
        val credentials = store.load() ?: return PendingOutcome.NotPaired
        return try {
            http.newCall(request(credentials, "/outbox/pending").build()).execute().use { response ->
                when (response.code) {
                    200 -> PendingOutcome.Replies(json.decodeFromString<PendingResponse>(response.body.string()).replies)
                    401 -> {
                        revoked()
                        PendingOutcome.Unauthorized
                    }
                    else -> PendingOutcome.Failed("server answered ${response.code}")
                }
            }
        } catch (e: IOException) {
            PendingOutcome.Failed(e.message ?: "network error")
        }
    }

    override fun report(id: String, sent: Boolean, error: String?): ReportOutcome {
        val credentials = store.load() ?: return ReportOutcome.NotPaired
        val body = if (sent) """{"status":"sent"}""" else """{"status":"failed","error":"${error ?: "failed"}"}"""
        val call = request(credentials, "/outbox/$id/result").post(body.toRequestBody(JSON_MEDIA_TYPE)).build()
        return try {
            http.newCall(call).execute().use { response ->
                when (response.code) {
                    200, 404 -> ReportOutcome.Reported // 404: the server forgot it, nothing left to tell
                    401 -> {
                        revoked()
                        ReportOutcome.Unauthorized
                    }
                    else -> ReportOutcome.Failed("server answered ${response.code}")
                }
            }
        } catch (e: IOException) {
            ReportOutcome.Failed(e.message ?: "network error")
        }
    }
}
