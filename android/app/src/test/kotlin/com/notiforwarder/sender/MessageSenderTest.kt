package com.notiforwarder.sender

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MessageSenderTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryTokenStore
    private lateinit var sender: MessageSender

    private val message = Message(
        id = "3f2b6c1e-8a4d-4f0e-9d3a-1b2c3d4e5f60",
        type = "notification",
        app = "com.bank",
        sender = "Bank",
        body = "Your code is 123456",
        receivedAt = "2025-11-11T10:00:05Z",
    )

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        store = InMemoryTokenStore(
            Credentials(server.url("/").toString().trimEnd('/'), "dev-1", "device-token"),
        )
        sender = MessageSender(store, appVersion = "0.1.0")
    }

    @After
    fun stop() {
        server.close()
    }

    private fun reply(code: Int, body: String = "{}") {
        server.enqueue(
            MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build(),
        )
    }

    @Test
    fun `posts the batch with the device token and app version`() {
        reply(201, """{"stored":1,"duplicates":0}""")

        val outcome = sender.send(listOf(message))

        assertEquals(SendOutcome.Sent(stored = 1, duplicates = 0), outcome)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/messages", request.url.encodedPath)
        assertEquals("Bearer device-token", request.headers["Authorization"])
        assertEquals("0.1.0", request.headers["X-App-Version"])
        val sent = Json.parseToJsonElement(request.body!!.utf8()).jsonObject["messages"]!!.jsonArray.single().jsonObject
        assertEquals(message.id, sent["id"]!!.jsonPrimitive.content)
        assertEquals("notification", sent["type"]!!.jsonPrimitive.content)
        assertEquals("com.bank", sent["app"]!!.jsonPrimitive.content)
        assertEquals("Bank", sent["sender"]!!.jsonPrimitive.content)
        assertEquals("Your code is 123456", sent["body"]!!.jsonPrimitive.content)
        assertEquals("2025-11-11T10:00:05Z", sent["receivedAt"]!!.jsonPrimitive.content)
    }

    @Test
    fun `does nothing when the phone is not paired`() {
        store.clear()

        assertEquals(SendOutcome.NotPaired, sender.send(listOf(message)))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a 401 means the phone was revoked, so the credentials are cleared`() {
        reply(401, """{"error":"unauthorized"}""")

        assertEquals(SendOutcome.Unauthorized, sender.send(listOf(message)))
        assertNull(store.load())
    }

    @Test
    fun `tells the app when the server revoked this phone, after the credentials are cleared`() {
        var storedWhenNotified: Credentials? = store.load()
        var notifications = 0
        sender = MessageSender(store, appVersion = "0.1.0", onRevoked = {
            notifications++
            storedWhenNotified = store.load()
        })
        reply(401, """{"error":"unauthorized"}""")

        sender.send(listOf(message))

        assertEquals(1, notifications)
        assertNull(storedWhenNotified)
    }

    @Test
    fun `does not announce a revocation for ordinary failures`() {
        var notifications = 0
        sender = MessageSender(store, appVersion = "0.1.0", onRevoked = { notifications++ })
        reply(500)
        reply(429)

        sender.send(listOf(message))
        sender.send(listOf(message))

        assertEquals(0, notifications)
    }

    @Test
    fun `a 400 means the server will never accept this payload`() {
        reply(400, """{"error":"invalid_payload"}""")

        assertEquals(SendOutcome.Rejected, sender.send(listOf(message)))
        assertNotNull(store.load())
    }

    @Test
    fun `temporary failures keep the credentials so the send can be retried`() {
        reply(429, """{"error":"rate_limited"}""")
        reply(503)

        assertEquals(SendOutcome.RateLimited, sender.send(listOf(message)))
        assertEquals(SendOutcome.ServerError(503), sender.send(listOf(message)))
        assertNotNull(store.load())
    }

    @Test
    fun `an unreachable server is reported and keeps the credentials`() {
        server.close()

        assertTrue(sender.send(listOf(message)) is SendOutcome.Unreachable)
        assertNotNull(store.load())
    }
}
