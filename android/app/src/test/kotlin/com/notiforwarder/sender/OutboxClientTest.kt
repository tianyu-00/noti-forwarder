package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OutboxClientTest {
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

    private fun client() = OutboxClient(store, appVersion = "0.1.9", onRevoked = { revoked++ })

    private fun json(code: Int, body: String) =
        server.enqueue(MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build())

    @Test
    fun `asks for the waiting replies with the device token and reads them`() {
        json(
            200,
            """{"replies":[{"id":"r1","deviceId":"dev-1","to":"+15551234567","body":"On my way","status":"queued","error":null,"createdAt":"2026-11-11T10:00:00.000Z","sentAt":null,"extra":1}]}""",
        )

        val outcome = client().pending()

        assertEquals(PendingOutcome.Replies(listOf(OutboxReply("r1", "+15551234567", "On my way"))), outcome)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/outbox/pending", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("0.1.9", request.headers["X-App-Version"])
    }

    @Test
    fun `an empty list is fine`() {
        json(200, """{"replies":[]}""")

        assertEquals(PendingOutcome.Replies(emptyList()), client().pending())
    }

    @Test
    fun `reports a reply as sent`() {
        json(200, "{}")

        val outcome = client().report("r1", sent = true, error = null)

        assertEquals(ReportOutcome.Reported, outcome)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/outbox/r1/result", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("""{"status":"sent"}""", request.body?.utf8())
    }

    @Test
    fun `reports a failure with a short reason code`() {
        json(200, "{}")

        client().report("r1", sent = false, error = "no_permission")

        assertEquals("""{"status":"failed","error":"no_permission"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `a reply the server no longer knows counts as done, so it is not reported forever`() {
        json(404, """{"error":"not_found"}""")

        assertEquals(ReportOutcome.Reported, client().report("gone", sent = true, error = null))
    }

    @Test
    fun `does nothing when the phone is not paired`() {
        store.clear()

        assertEquals(PendingOutcome.NotPaired, client().pending())
        assertEquals(ReportOutcome.NotPaired, client().report("r1", sent = true, error = null))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a rejected token means the phone was revoked, so credentials are cleared`() {
        json(401, """{"error":"unauthorized"}""")

        assertEquals(PendingOutcome.Unauthorized, client().pending())
        assertNull(store.load())
        assertEquals(1, revoked)
    }

    @Test
    fun `server trouble and an unreachable server are failures to try again later`() {
        json(500, "{}")
        assertTrue(client().pending() is PendingOutcome.Failed)
        json(500, "{}")
        assertTrue(client().report("r1", sent = true, error = null) is ReportOutcome.Failed)

        server.close()
        assertTrue(client().pending() is PendingOutcome.Failed)
        assertTrue(client().report("r1", sent = true, error = null) is ReportOutcome.Failed)
    }
}
