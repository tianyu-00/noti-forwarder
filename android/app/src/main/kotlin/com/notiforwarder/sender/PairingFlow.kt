package com.notiforwarder.sender

/** Pairs with the server and keeps the credentials only if it worked. */
class PairingFlow(
    private val store: TokenStore,
    /** The role this phone chose. A code made for the other role is refused, and nothing is kept. */
    private val expectedRole: () -> AppRole = { AppRole.Sender },
    private val pairWithServer: (PairingTarget, DeviceInfo) -> PairOutcome,
) {
    constructor(store: TokenStore, client: PairingClient, expectedRole: () -> AppRole = { AppRole.Sender }) :
        this(store, expectedRole, client::pair)

    fun pair(target: PairingTarget, device: DeviceInfo): PairOutcome {
        val outcome = pairWithServer(target, device)
        if (outcome !is PairOutcome.Paired) return outcome
        val expected = expectedRole()
        if (!outcome.role.equals(expected.name, ignoreCase = true)) return PairOutcome.WrongRole(expected, outcome.role)
        store.save(Credentials(target.serverUrl, outcome.deviceId, outcome.token, target.e2eKey))
        return outcome
    }
}
