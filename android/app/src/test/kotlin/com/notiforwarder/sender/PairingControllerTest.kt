package com.notiforwarder.sender

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingControllerTest {
    private val device = DeviceInfo("Phone", "HD1913", "0.1.0")
    private val code = "ABCD-EFGH-IJKL"
    private val saved = Credentials("https://nf.example.com", "dev-1", "tok")

    private class Harness(store: TokenStore, outcome: () -> PairOutcome) {
        var calls = 0
        lateinit var controller: PairingController
        val seenDuringPairing = mutableListOf<UiState>()

        init {
            val flow = PairingFlow(store) { target, _ ->
                calls++
                seenDuringPairing += controller.state.value
                val result = outcome()
                if (result is PairOutcome.Paired) {
                    store.save(Credentials(target.serverUrl, result.deviceId, result.token))
                }
                result
            }
            controller = PairingController(store, flow, DeviceInfo("Phone", "HD1913", "0.1.0"), Dispatchers.Unconfined)
        }
    }

    @Test
    fun `starts unpaired when nothing is stored, paired when credentials exist`() {
        assertEquals(UiState.Unpaired(null), Harness(InMemoryTokenStore()) { error("unused") }.controller.state.value)
        assertEquals(
            UiState.Paired("https://nf.example.com", "dev-1"),
            Harness(InMemoryTokenStore(saved)) { error("unused") }.controller.state.value,
        )
    }

    @Test
    fun `bad manual input shows the reason and never calls the server`() {
        val h = Harness(InMemoryTokenStore()) { error("must not be called") }

        runBlocking { h.controller.pairManual("http://nf.example.com", code) }

        assertTrue(h.controller.state.value is UiState.Unpaired)
        assertTrue((h.controller.state.value as UiState.Unpaired).error!!.contains("https"))
        assertEquals(0, h.calls)
    }

    @Test
    fun `pairs by hand, showing a pairing state while it waits`() {
        val h = Harness(InMemoryTokenStore()) { PairOutcome.Paired("dev-9", "tok-9") }

        runBlocking { h.controller.pairManual("nf.example.com", code) }

        assertEquals(listOf<UiState>(UiState.Pairing), h.seenDuringPairing)
        assertEquals(UiState.Paired("https://nf.example.com", "dev-9"), h.controller.state.value)
    }

    @Test
    fun `asks for a flush after pairing, so messages queued while unpaired go out`() {
        var flushes = 0
        val store = InMemoryTokenStore()
        val flow = PairingFlow(store) { target, _ ->
            store.save(Credentials(target.serverUrl, "dev-3", "tok-3"))
            PairOutcome.Paired("dev-3", "tok-3")
        }
        val controller = PairingController(store, flow, device, Dispatchers.Unconfined, onPaired = { flushes++ })

        runBlocking { controller.pairManual("nf.example.com", code) }

        assertEquals(1, flushes)
    }

    @Test
    fun `does not ask for a flush when pairing fails`() {
        var flushes = 0
        val store = InMemoryTokenStore()
        val flow = PairingFlow(store) { _, _ -> PairOutcome.InvalidCode }
        val controller = PairingController(store, flow, device, Dispatchers.Unconfined, onPaired = { flushes++ })

        runBlocking { controller.pairManual("nf.example.com", code) }

        assertEquals(0, flushes)
    }

    @Test
    fun `announces when the phone becomes unpaired, by the user or by a revocation`() {
        var unpaired = 0

        // by the user
        val store1 = InMemoryTokenStore(saved)
        val flow1 = PairingFlow(store1) { _, _ -> error("unused") }
        PairingController(store1, flow1, device, Dispatchers.Unconfined, onUnpaired = { unpaired++ }).unpair()
        assertEquals(1, unpaired)

        // by the server revoking it (the sender cleared the credentials)
        val store2 = InMemoryTokenStore(saved)
        val flow2 = PairingFlow(store2) { _, _ -> error("unused") }
        val controller = PairingController(store2, flow2, device, Dispatchers.Unconfined, onUnpaired = { unpaired++ })
        store2.clear()
        controller.refresh()
        assertEquals(2, unpaired)
    }

    @Test
    fun `does not announce an unpairing while the phone is still paired or never was`() {
        var unpaired = 0
        val paired = PairingController(
            InMemoryTokenStore(saved),
            PairingFlow(InMemoryTokenStore(saved)) { _, _ -> error("unused") },
            device,
            Dispatchers.Unconfined,
            onUnpaired = { unpaired++ },
        )
        paired.refresh()

        val neverPaired = Harness(InMemoryTokenStore()) { PairOutcome.InvalidCode }
        runBlocking { neverPaired.controller.pairManual("nf.example.com", code) }
        neverPaired.controller.refresh()

        assertEquals(0, unpaired)
    }

    @Test
    fun `pairs from a scanned QR code`() {
        val h = Harness(InMemoryTokenStore()) { PairOutcome.Paired("dev-2", "tok-2") }

        runBlocking { h.controller.pairFromQr("""{"u":"https://nf.example.com","c":"$code"}""") }

        assertEquals(UiState.Paired("https://nf.example.com", "dev-2"), h.controller.state.value)
    }

    @Test
    fun `a scanned code that is not ours is rejected without calling the server`() {
        val h = Harness(InMemoryTokenStore()) { error("must not be called") }

        runBlocking { h.controller.pairFromQr("https://example.com") }

        assertTrue((h.controller.state.value as UiState.Unpaired).error!!.isNotBlank())
        assertEquals(0, h.calls)
    }

    @Test
    fun `explains each way pairing can fail`() {
        fun errorFor(outcome: PairOutcome): String {
            val h = Harness(InMemoryTokenStore()) { outcome }
            runBlocking { h.controller.pairManual("nf.example.com", code) }
            return (h.controller.state.value as UiState.Unpaired).error!!
        }

        assertTrue(errorFor(PairOutcome.InvalidCode).contains("expired", ignoreCase = true))
        assertTrue(errorFor(PairOutcome.RateLimited).contains("too many", ignoreCase = true))
        assertTrue(errorFor(PairOutcome.Unreachable("timeout")).contains("reach", ignoreCase = true))
        assertTrue(errorFor(PairOutcome.ServerError(500)).contains("500"))
    }

    @Test
    fun `unpairing forgets the credentials`() {
        val store = InMemoryTokenStore(saved)
        val h = Harness(store) { error("unused") }

        h.controller.unpair()

        assertEquals(UiState.Unpaired(null), h.controller.state.value)
        assertEquals(null, store.load())
    }

    @Test
    fun `notices when the server revoked the phone`() {
        val store = InMemoryTokenStore(saved)
        val h = Harness(store) { error("unused") }
        assertTrue(h.controller.state.value is UiState.Paired)

        store.clear() // what MessageSender does after a 401
        h.controller.refresh()

        val state = h.controller.state.value as UiState.Unpaired
        assertTrue(state.error!!.contains("removed", ignoreCase = true))
    }
}
