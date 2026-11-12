package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingFlowTest {
    private val target = PairingTarget("https://nf.example.com", "KEY")
    private val device = DeviceInfo("Phone", "HD1913", "0.1.0")

    private fun flow(store: TokenStore, outcome: PairOutcome) =
        PairingFlow(store) { _, _ -> outcome }

    @Test
    fun `stores the credentials once the server accepts the code`() {
        val store = InMemoryTokenStore()

        val outcome = flow(store, PairOutcome.Paired("dev-1", "tok")).pair(target, device)

        assertEquals(PairOutcome.Paired("dev-1", "tok"), outcome)
        assertEquals(Credentials("https://nf.example.com", "dev-1", "tok"), store.load())
    }

    @Test
    fun `stores nothing when pairing fails`() {
        for (failure in listOf(PairOutcome.InvalidCode, PairOutcome.RateLimited, PairOutcome.ServerError(500))) {
            val store = InMemoryTokenStore()
            flow(store, failure).pair(target, device)
            assertNull(store.load())
        }
    }

    @Test
    fun `a failed attempt does not wipe an existing pairing`() {
        val existing = Credentials("https://nf.example.com", "old", "old-token")
        val store = InMemoryTokenStore(existing)

        flow(store, PairOutcome.InvalidCode).pair(target, device)

        assertEquals(existing, store.load())
    }

    @Test
    fun `keeps the encryption key with the credentials`() {
        val store = InMemoryTokenStore()
        val keyed = PairingTarget("https://nf.example.com", "KEY", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")

        flow(store, PairOutcome.Paired("dev-1", "tok")).pair(keyed, device)

        assertEquals(keyed.e2eKey, store.load()?.e2eKey)
    }
}
