package com.notiforwarder.sender

import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** One SIM as the server and dashboard see it: [allowed] says whether replies may go out on it. */
@Serializable
data class ReportedSim(val id: Int, val slot: Int, val name: String, val allowed: Boolean)

@Serializable
private data class SimsBody(val sims: List<ReportedSim>)

/** What the SIM reporting needs from the server. A seam so the logic is tested without a network. */
interface SimsApi {
    fun put(sims: List<ReportedSim>): ReportOutcome
}

/** Blocking: call it off the main thread. */
class SimsClient(
    private val store: TokenStore,
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttpClient(),
    /** Called after the credentials are cleared because the server revoked this phone. */
    private val onRevoked: () -> Unit = {},
) : SimsApi {
    override fun put(sims: List<ReportedSim>): ReportOutcome {
        val credentials = store.load() ?: return ReportOutcome.NotPaired
        val body = Json.encodeToString(SimsBody.serializer(), SimsBody(sims))
        val call = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/sims")
            .header("Authorization", "Bearer ${credentials.token}")
            .header("X-App-Version", appVersion)
            .put(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        return try {
            http.newCall(call).execute().use { response ->
                when (response.code) {
                    204, 200 -> ReportOutcome.Reported
                    401 -> {
                        store.clear()
                        onRevoked()
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

/**
 * Tells the server which SIMs the phone has and allows, so the dashboard can offer them. Sends only
 * when the list changed (or [force]d, for a new connection). When the SIMs cannot be listed it reports an
 * empty list. Safe to call from any thread.
 */
class SimReporter(
    private val api: SimsApi,
    private val installed: () -> List<SimOption>?,
    private val allowed: () -> Set<Int>,
) {
    private var last: List<ReportedSim>? = null

    @Synchronized
    fun report(force: Boolean = false) {
        // Cannot list them (no phone access): say "none", so the dashboard can explain why replies are off.
        val sims = installed().orEmpty()
        val allow = allowed()
        val list = sims.map { ReportedSim(it.id, it.slot, it.name, it.id in allow) }
        if (!force && list == last) return
        if (api.put(list) == ReportOutcome.Reported) last = list
    }
}
