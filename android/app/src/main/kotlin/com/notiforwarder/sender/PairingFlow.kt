package com.notiforwarder.sender

/** Pairs with the server and keeps the credentials only if it worked. */
class PairingFlow(
    private val store: TokenStore,
    private val pairWithServer: (PairingTarget, DeviceInfo) -> PairOutcome,
) {
    constructor(store: TokenStore, client: PairingClient) : this(store, client::pair)

    fun pair(target: PairingTarget, device: DeviceInfo): PairOutcome {
        val outcome = pairWithServer(target, device)
        if (outcome is PairOutcome.Paired) {
            store.save(Credentials(target.serverUrl, outcome.deviceId, outcome.token, target.e2eKey))
        }
        return outcome
    }
}
