package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UnpairClientTest {
    private lateinit var server: MockWebServer
    private lateinit var credentials: Credentials

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        credentials = Credentials(server.url("/").toString().trimEnd('/'), "dev-1", "device-token")
    }

    @After
    fun stop() {
        server.close()
    }

    @Test
    fun `tells the server with the device token`() {
        server.enqueue(MockResponse.Builder().code(204).build())

        assertTrue(UnpairClient().unpair(credentials))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/unpair", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
    }

    @Test
    fun `never throws, it only reports that the server was not told`() {
        server.enqueue(MockResponse.Builder().code(500).build())
        assertFalse(UnpairClient().unpair(credentials))

        server.close()
        assertFalse(UnpairClient().unpair(credentials))
    }
}
