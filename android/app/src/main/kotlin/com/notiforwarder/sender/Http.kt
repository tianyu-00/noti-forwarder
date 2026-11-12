package com.notiforwarder.sender

import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient

internal val JSON_MEDIA_TYPE = "application/json".toMediaType()

internal fun defaultHttpClient(): OkHttpClient =
    OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
