package com.notiforwarder.sender

import java.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
private data class RecentResponse(val messages: List<ReceivedMessage>)

/** The receiver's requests to the server: the newest messages. Blocking: call it off the main thread. */
class ReceiverClient(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttpClient(),
    /** Called after the credentials are cleared because the server removed this phone. */
    private val onRevoked: () -> Unit = {},
) : ReceiverApi {
    private val json = Json { ignoreUnknownKeys = true }

    override fun recent(limit: Int): RecentOutcome {
        val credentials = store.load() ?: return RecentOutcome.Failed("not paired")
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/receiver/messages?limit=$limit")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                when (response.code) {
                    200 -> try {
                        RecentOutcome.Messages(json.decodeFromString<RecentResponse>(response.body.string()).messages)
                    } catch (e: SerializationException) {
                        RecentOutcome.Failed("unexpected answer")
                    } catch (e: IllegalArgumentException) {
                        RecentOutcome.Failed("unexpected answer")
                    }
                    401 -> {
                        store.clear()
                        onRevoked()
                        RecentOutcome.Unauthorized
                    }
                    else -> RecentOutcome.Failed("server answered ${response.code}")
                }
            }
        } catch (e: IOException) {
            RecentOutcome.Failed(e.message ?: "network error")
        }
    }
}
