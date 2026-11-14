package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SimsClientTest {
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

    private fun client() = SimsClient(store, appVersion = "0.1.9", onRevoked = { revoked++ })
    private val sims = listOf(ReportedSim(3, 1, "China Mobile", false), ReportedSim(5, 2, "Giffgaff", true))
    private val replies = ReportedReplies(on = true, permission = false, practice = false)

    @Test
    fun `puts the SIM list to the server with the device token`() {
        server.enqueue(MockResponse.Builder().code(204).build())

        val outcome = client().put(sims, replies)

        assertEquals(ReportOutcome.Reported, outcome)
        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/api/v1/sims", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("0.1.9", request.headers["X-App-Version"])
        assertEquals(
            """{"sims":[{"id":3,"slot":1,"name":"China Mobile","allowed":false},{"id":5,"slot":2,"name":"Giffgaff","allowed":true}],"replies":{"on":true,"permission":false,"practice":false}}""",
            request.body!!.utf8(),
        )
    }

    @Test
    fun `a revoked phone clears its credentials`() {
        server.enqueue(MockResponse.Builder().code(401).build())

        assertEquals(ReportOutcome.Unauthorized, client().put(sims, replies))
        assertEquals(1, revoked)
        assertTrue(store.load() == null)
    }

    @Test
    fun `an unpaired phone sends nothing`() {
        store.clear()

        assertEquals(ReportOutcome.NotPaired, client().put(sims, replies))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `an unreachable server is a failure to retry, not a crash`() {
        server.close()

        assertTrue(client().put(sims, replies) is ReportOutcome.Failed)
    }
}
