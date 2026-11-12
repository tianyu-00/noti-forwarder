package com.notiforwarder.sender

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Tells the server this phone is unpairing itself, so the dashboard shows it as unpaired at once
 * instead of slowly turning "quiet". Best effort: the phone unpairs locally whether or not this
 * works. Blocking: call it off the main thread.
 */
class UnpairClient(
    private val http: OkHttpClient = defaultHttpClient().newBuilder().callTimeout(8, TimeUnit.SECONDS).build(),
) {
    /** True if the server was told. Never throws. */
    fun unpair(credentials: Credentials): Boolean {
        val request = Request.Builder()
            .url("${credentials.serverUrl}/api/v1/unpair")
            .header("Authorization", "Bearer ${credentials.token}")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        return try {
            http.newCall(request).execute().use { it.code == 204 }
        } catch (e: IOException) {
            false
        }
    }
}
