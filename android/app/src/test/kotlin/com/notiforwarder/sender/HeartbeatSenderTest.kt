package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HeartbeatSenderTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore
    private var revoked = 0

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        store = InMemoryTokenStore(Credentials(server.url("/").toString().trimEnd('/'), "dev-1", "device-token"))
        revoked = 0
    }

    @After
    fun stop() {
        server.close()
    }

    private var reading: BatteryReading? = null

    private fun sender() = HeartbeatSender(store, appVersion = "0.1.9", onRevoked = { revoked++ }, battery = { reading })

    private fun reply(code: Int) = server.enqueue(MockResponse.Builder().code(code).build())

    @Test
    fun `checks in with the device token and app version`() {
        reply(204)

        val outcome = sender().send()

        assertEquals(HeartbeatOutcome.Sent, outcome)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/heartbeat", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("0.1.9", request.headers["X-App-Version"])
    }

    @Test
    fun `says how full the battery is, and whether it is charging`() {
        reading = BatteryReading(63, true)
        reply(204)

        sender().send()

        val request = server.takeRequest()
        assertEquals("application/json; charset=utf-8", request.headers["Content-Type"])
        assertEquals("""{"battery":{"percent":63,"charging":true}}""", request.body?.utf8())
    }

    @Test
    fun `sends no body when the battery cannot be read`() {
        reading = null
        reply(204)

        sender().send()

        assertEquals(0L, server.takeRequest().bodySize)
    }

    @Test
    fun `sends nothing when the phone is not paired`() {
        store.clear()

        assertEquals(HeartbeatOutcome.NotPaired, sender().send())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a revoked phone clears its credentials and says so`() {
        reply(401)

        assertEquals(HeartbeatOutcome.Unauthorized, sender().send())

        assertNull(store.load())
        assertEquals(1, revoked)
    }

    @Test
    fun `reports a server error and a network error without touching the credentials`() {
        reply(500)
        assertEquals(HeartbeatOutcome.ServerError(500), sender().send())

        server.close()
        assertTrue(sender().send() is HeartbeatOutcome.Unreachable)
        assertEquals(Credentials(store.load()!!.serverUrl, "dev-1", "device-token"), store.load())
    }
}
