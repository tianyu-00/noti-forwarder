package com.notiforwarder.sender

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

sealed interface UiState {
    data class Unpaired(val error: String? = null) : UiState
    data object Pairing : UiState
    data class Paired(val serverUrl: String, val deviceId: String, val encrypted: Boolean = false) : UiState
}

/** Holds the pairing screen's state. Plain Kotlin so it is testable on the JVM. */
class PairingController(
    private val store: TokenStore,
    private val flow: PairingFlow,
    private val device: DeviceInfo,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    /** Called after a successful pairing, e.g. to send messages queued while unpaired. */
    private val onPaired: () -> Unit = {},
    /** Called when the phone becomes unpaired, e.g. to remove the "running" notice. */
    private val onUnpaired: () -> Unit = {},
    /** Tells the server this phone unpaired itself. Best effort; the phone unpairs either way. */
    private val unpairOnServer: (Credentials) -> Unit = {},
) {
    private val scope = CoroutineScope(SupervisorJob() + ioDispatcher)

    private val _state = MutableStateFlow<UiState>(stateFromStore())
    val state: StateFlow<UiState> = _state

    suspend fun pairFromQr(text: String) = pair(PairingInput.fromQr(text))

    suspend fun pairManual(address: String, key: String, encryptionKey: String = "") =
        pair(PairingInput.fromManual(address, key, encryptionKey))

    fun unpair() {
        val old = store.load()
        store.clear()
        _state.value = UiState.Unpaired()
        onUnpaired()
        // After the screen has changed, so a slow or missing network never holds up the button.
        if (old != null) scope.launch { runCatching { unpairOnServer(old) } }
    }

    /** Re-reads storage, e.g. after the sender cleared it because the server revoked this phone. */
    fun refresh() {
        val credentials = store.load()
        when {
            credentials != null -> _state.value = paired(credentials)
            _state.value is UiState.Paired -> {
                _state.value = UiState.Unpaired("This phone was removed from the server. Pair it again.")
                onUnpaired()
            }
        }
    }

    private suspend fun pair(input: PairingResult) {
        if (input is PairingResult.Invalid) {
            _state.value = UiState.Unpaired(input.reason)
            return
        }
        val target = (input as PairingResult.Ok).target
        _state.value = UiState.Pairing
        val outcome = withContext(ioDispatcher) { flow.pair(target, device) }
        _state.value = when (outcome) {
            is PairOutcome.Paired -> {
                onPaired()
                UiState.Paired(target.serverUrl, outcome.deviceId, encrypted = target.e2eKey != null)
            }
            PairOutcome.InvalidCode -> UiState.Unpaired("That key is invalid or expired. Create a new one on the dashboard.")
            PairOutcome.RateLimited -> UiState.Unpaired("Too many attempts. Wait a few minutes and try again.")
            is PairOutcome.Unreachable -> UiState.Unpaired("Could not reach the server. Check the address and your connection.")
            is PairOutcome.ServerError -> UiState.Unpaired("The server returned an error (${outcome.status}).")
        }
    }

    private fun stateFromStore(): UiState =
        store.load()?.let(::paired) ?: UiState.Unpaired()

    private fun paired(credentials: Credentials) =
        UiState.Paired(credentials.serverUrl, credentials.deviceId, encrypted = credentials.e2eKey != null)
}
