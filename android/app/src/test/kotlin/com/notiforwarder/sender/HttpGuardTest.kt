package com.notiforwarder.sender

import java.io.IOException
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class HttpGuardTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.close()
    }

    @Test
    fun `refuses a cleartext request to a server outside the local network`() {
        try {
            defaultHttpClient().newCall(Request.Builder().url("http://8.8.8.8/api/v1/messages").build()).execute()
            fail("expected the request to be refused")
        } catch (e: IOException) {
            assertTrue(e.message.orEmpty().contains("local network"))
        }
    }

    @Test
    fun `does not follow a redirect, so cleartext cannot be reached by redirection`() {
        server.enqueue(
            MockResponse.Builder().code(302).addHeader("Location", "http://8.8.8.8/steal").build(),
        )

        defaultHttpClient().newCall(Request.Builder().url(server.url("/")).build()).execute().use {
            assertEquals(302, it.code)
        }
        assertEquals(1, server.requestCount)
    }
}
