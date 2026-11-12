package com.notiforwarder.sender

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient

internal val JSON_MEDIA_TYPE = "application/json".toMediaType()

/**
 * The manifest allows cleartext traffic (Android cannot limit it to IP ranges), so this is the
 * real gate: plain http:// is refused for any host outside the local network, before a
 * connection is made. Redirects are not followed, so a server cannot bounce the phone to a
 * cleartext address.
 */
private val localNetworkOnlyForCleartext = Interceptor { chain ->
    val url = chain.request().url
    if (!url.isHttps && !LocalNetwork.isLocalHost(url.host)) {
        throw IOException("Plain http:// is only allowed on your local network. Use an https:// address.")
    }
    chain.proceed(chain.request())
}

internal fun defaultHttpClient(): OkHttpClient =
    OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(localNetworkOnlyForCleartext)
        .build()

/**
 * For the phone's long-lived connection: no overall time limit, but a read timeout longer than
 * the server's 25-second ping, so a connection that has silently died is dropped and replaced
 * within about a minute.
 */
internal fun streamHttpClient(): OkHttpClient =
    defaultHttpClient().newBuilder().callTimeout(0, TimeUnit.MILLISECONDS).readTimeout(70, TimeUnit.SECONDS).build()
