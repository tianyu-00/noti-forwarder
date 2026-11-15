package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ReceiverClientTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore
    private var revoked = 0

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        store = InMemoryTokenStore(Credentials(server.url("/").toString().trimEnd('/'), "dev-1", "receiver-token"))
        revoked = 0
    }

    @After
    fun stop() {
        server.close()
    }

    private fun client() = ReceiverClient(store, appVersion = "0.1.9", onRevoked = { revoked++ })

    private fun reply(code: Int, body: String = "") =
        server.enqueue(MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build())

    private val body = """{"messages":[
        {"id":"m2","deviceId":"d1","deviceName":"Kitchen","type":"sms","app":"sms","appLabel":null,"sender":"BANK","body":"hi","receivedAt":"2026-11-11T10:00:02.000Z","createdAt":"2026-11-11T10:00:03.000Z","code":null,"sim":3},
        {"id":"m1","deviceId":"d1","type":"notification","app":"com.google.android.gm","appLabel":"Gmail","sender":"e2e:v1:AA","body":"e2e:v1:BB","receivedAt":"2026-11-11T10:00:01.000Z","code":"482913"}]}"""

    @Test
    fun `asks for the newest messages with the receiver token and reads them`() {
        reply(200, body)

        val outcome = client().recent(limit = 50) as RecentOutcome.Messages

        assertEquals(listOf("m2", "m1"), outcome.messages.map { it.id })
        assertEquals("Kitchen", outcome.messages[0].deviceName)
        assertNull(outcome.messages[1].deviceName) // an older server does not say
        assertEquals("482913", outcome.messages[1].code)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/receiver/messages", request.url.encodedPath)
        assertEquals("50", request.url.queryParameter("limit"))
        assertEquals("Bearer receiver-token", request.headers["Authorization"])
        assertEquals("0.1.9", request.headers["X-App-Version"])
    }

    @Test
    fun `an empty list is fine`() {
        reply(200, """{"messages":[]}""")

        assertEquals(RecentOutcome.Messages(emptyList()), client().recent(10))
    }

    @Test
    fun `a rejected token means this phone was removed, so its credentials are cleared`() {
        reply(401)

        assertEquals(RecentOutcome.Unauthorized, client().recent(10))
        assertNull(store.load())
        assertEquals(1, revoked)
    }

    @Test
    fun `a server error or a network failure is a failure to try again, not a crash`() {
        reply(500)
        assertTrue(client().recent(10) is RecentOutcome.Failed)

        server.close()
        assertTrue(client().recent(10) is RecentOutcome.Failed)
    }

    @Test
    fun `answers that are not the expected shape are a failure too`() {
        reply(200, "<html>proxy error</html>")

        assertTrue(client().recent(10) is RecentOutcome.Failed)
    }

    @Test
    fun `an unpaired phone asks nothing`() {
        store.clear()

        assertTrue(client().recent(10) is RecentOutcome.Failed)
        assertEquals(0, server.requestCount)
    }
}
