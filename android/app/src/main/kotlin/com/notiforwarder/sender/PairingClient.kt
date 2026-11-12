package com.notiforwarder.sender

import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class DeviceInfo(val name: String, val model: String, val appVersion: String)

sealed interface PairOutcome {
    data class Paired(val deviceId: String, val token: String) : PairOutcome
    data object InvalidCode : PairOutcome
    data object RateLimited : PairOutcome
    data class ServerError(val status: Int) : PairOutcome
    data class Unreachable(val reason: String) : PairOutcome
}

@Serializable
private data class PairRequest(val code: String, val name: String, val model: String, val appVersion: String)

@Serializable
private data class PairResponse(val deviceId: String, val token: String)

/** Blocking: call it off the main thread. */
class PairingClient(
    private val http: OkHttpClient = defaultHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun pair(target: PairingTarget, device: DeviceInfo): PairOutcome {
        val body = json.encodeToString(
            PairRequest(target.code, device.name, device.model, device.appVersion),
        ).toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("${target.serverUrl}/api/v1/pair")
            .header("X-App-Version", device.appVersion)
            .post(body)
            .build()

        return try {
            http.newCall(request).execute().use { response ->
                when {
                    response.code == 201 -> {
                        val parsed = json.decodeFromString<PairResponse>(response.body.string())
                        PairOutcome.Paired(parsed.deviceId, parsed.token)
                    }
                    response.code == 400 -> PairOutcome.InvalidCode
                    response.code == 429 -> PairOutcome.RateLimited
                    else -> PairOutcome.ServerError(response.code)
                }
            }
        } catch (e: IOException) {
            PairOutcome.Unreachable(e.message ?: "network error")
        }
    }
}
