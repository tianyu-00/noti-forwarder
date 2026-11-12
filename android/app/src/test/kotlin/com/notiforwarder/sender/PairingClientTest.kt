package com.notiforwarder.sender

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PairingClientTest {
    private lateinit var server: MockWebServer
    private val device = DeviceInfo(name = "OnePlus 7T Pro", model = "HD1913", appVersion = "0.1.0")
    private val client = PairingClient()

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.close()
    }

    private fun target() = PairingTarget(server.url("/").toString().trimEnd('/'), "ABCD-EFGH-IJKL")

    private fun reply(code: Int, body: String) {
        server.enqueue(
            MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build(),
        )
    }

    @Test
    fun `sends the code and device details and returns the device token`() {
        reply(201, """{"deviceId":"dev-1","token":"secret-token"}""")

        val outcome = client.pair(target(), device)

        assertEquals(PairOutcome.Paired(deviceId = "dev-1", token = "secret-token"), outcome)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/pair", request.url.encodedPath)
        assertEquals("0.1.0", request.headers["X-App-Version"])
        val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
        assertEquals("ABCD-EFGH-IJKL", body["code"]!!.jsonPrimitive.content)
        assertEquals("OnePlus 7T Pro", body["name"]!!.jsonPrimitive.content)
        assertEquals("HD1913", body["model"]!!.jsonPrimitive.content)
        assertEquals("0.1.0", body["appVersion"]!!.jsonPrimitive.content)
    }

    @Test
    fun `reports an invalid or expired code`() {
        reply(400, """{"error":"invalid_code"}""")

        assertEquals(PairOutcome.InvalidCode, client.pair(target(), device))
    }

    @Test
    fun `reports rate limiting`() {
        reply(429, """{"error":"rate_limited"}""")

        assertEquals(PairOutcome.RateLimited, client.pair(target(), device))
    }

    @Test
    fun `reports other server errors with the status`() {
        reply(500, """{"error":"internal_error"}""")

        assertEquals(PairOutcome.ServerError(500), client.pair(target(), device))
    }

    @Test
    fun `reports an unreachable server`() {
        val unreachable = target()
        server.close()

        assertTrue(client.pair(unreachable, device) is PairOutcome.Unreachable)
    }
}
