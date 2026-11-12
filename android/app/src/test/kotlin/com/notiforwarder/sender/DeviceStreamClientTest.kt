package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class DeviceStreamClientTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        store = InMemoryTokenStore(Credentials(server.url("/").toString().trimEnd('/'), "dev-1", "device-token"))
    }

    @After
    fun stop() {
        server.close()
    }

    private fun client() = DeviceStreamClient(store, appVersion = "0.1.9")

    private fun stream(body: String) = server.enqueue(
        MockResponse.Builder().code(200).addHeader("Content-Type", "text/event-stream").body(body).build(),
    )

    @Test
    fun `connects with the device token and ends as revoked when the server says so`() {
        stream(": connected\n\nevent: revoked\ndata: {}\n\n")

        val end = client().run()

        assertEquals(StreamEnd.Revoked, end)
        val request = server.takeRequest()
        assertEquals("/api/v1/device-stream", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("0.1.9", request.headers["X-App-Version"])
    }

    @Test
    fun `ignores pings and events it does not know`() {
        stream(": connected\n\n: ping\n\nevent: something-new\ndata: {}\n\n: ping\n\nevent: revoked\ndata: {}\n\n")

        assertEquals(StreamEnd.Revoked, client().run())
    }

    @Test
    fun `a rejected token means the phone was revoked`() {
        server.enqueue(MockResponse.Builder().code(401).build())

        assertEquals(StreamEnd.Revoked, client().run())
    }

    @Test
    fun `a stream that just closes is a drop after being connected`() {
        stream(": connected\n\n: ping\n\n")

        assertEquals(StreamEnd.Dropped(wasConnected = true), client().run())
    }

    @Test
    fun `an unreachable server is a drop without ever being connected`() {
        server.close()

        assertEquals(StreamEnd.Dropped(wasConnected = false), client().run())
    }

    @Test
    fun `a server error is a drop without being connected`() {
        server.enqueue(MockResponse.Builder().code(503).build())

        assertEquals(StreamEnd.Dropped(wasConnected = false), client().run())
    }

    @Test
    fun `does nothing when the phone is not paired`() {
        store.clear()

        assertEquals(StreamEnd.NotPaired, client().run())
        assertEquals(0, server.requestCount)
    }
}
