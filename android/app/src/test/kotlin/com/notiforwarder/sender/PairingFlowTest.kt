package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingFlowTest {
    private val target = PairingTarget("https://nf.example.com", "KEY")
    private val device = DeviceInfo("Phone", "HD1913", "0.1.0")

    private fun flow(store: TokenStore, outcome: PairOutcome, expected: AppRole = AppRole.Sender) =
        PairingFlow(store, expectedRole = { expected }) { _, _ -> outcome }

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

    @Test
    fun `a receiver is paired with a receiver code`() {
        val store = InMemoryTokenStore()

        val outcome = flow(store, PairOutcome.Paired("dev-1", "tok", role = "receiver"), expected = AppRole.Receiver).pair(target, device)

        assertEquals(PairOutcome.Paired("dev-1", "tok", role = "receiver"), outcome)
        assertEquals("dev-1", store.load()?.deviceId)
    }

    @Test
    fun `a code made for the other role is refused and nothing is stored`() {
        val store = InMemoryTokenStore()

        val asSender = flow(store, PairOutcome.Paired("dev-1", "tok", role = "receiver"), expected = AppRole.Sender).pair(target, device)
        val asReceiver = flow(store, PairOutcome.Paired("dev-2", "tok", role = "sender"), expected = AppRole.Receiver).pair(target, device)

        assertEquals(PairOutcome.WrongRole(expected = AppRole.Sender, actual = "receiver"), asSender)
        assertEquals(PairOutcome.WrongRole(expected = AppRole.Receiver, actual = "sender"), asReceiver)
        assertNull(store.load())
    }

    @Test
    fun `an older server that does not say its role is a sender server`() {
        val store = InMemoryTokenStore()

        flow(store, PairOutcome.Paired("dev-1", "tok")).pair(target, device)

        assertEquals("dev-1", store.load()?.deviceId)
    }
}
