package com.notiforwarder.sender

import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Where to pair and the single-use key to pair with. */
data class PairingTarget(val serverUrl: String, val code: String, val e2eKey: String? = null)

sealed interface PairingResult {
    data class Ok(val target: PairingTarget) : PairingResult
    data class Invalid(val reason: String) : PairingResult
}

@Serializable
private data class QrPayload(val u: String, val c: String, val k: String? = null)

object PairingInput {
    private val json = Json { ignoreUnknownKeys = true }

    /** Parses the text of the QR code shown on the web dashboard. */
    fun fromQr(text: String): PairingResult {
        val payload = try {
            json.decodeFromString<QrPayload>(text)
        } catch (e: Exception) {
            return PairingResult.Invalid("This is not a Notiforwarder pairing code.")
        }
        return build(payload.u, payload.c, payload.k.orEmpty())
    }

    /** Validates the address, security key and optional encryption key typed in by hand. */
    fun fromManual(address: String, key: String, encryptionKey: String = ""): PairingResult =
        build(address, key, encryptionKey)

    private fun build(address: String, key: String, encryptionKey: String): PairingResult {
        val server = normalizeServer(address)
            ?: return PairingResult.Invalid("Enter an https:// server address (http:// is allowed only on your own network).")
        val code = key.trim()
        if (code.isEmpty()) return PairingResult.Invalid("Enter the security key.")
        val e2e = encryptionKey.trim().takeIf { it.isNotEmpty() }
        if (e2e != null && !E2eCipher.isValidKey(e2e)) return PairingResult.Invalid("The encryption key is not valid.")
        return PairingResult.Ok(PairingTarget(server, code, e2e))
    }

    /**
     * HTTPS everywhere, except that plain http:// is accepted for a server on the local network
     * (see [LocalNetwork]). Returns null if the address is unusable.
     */
    private fun normalizeServer(raw: String): String? {
        var value = raw.trim().trimEnd('/')
        if (value.isEmpty()) return null
        val explicitScheme = if ("://" in value) value.substringBefore("://").lowercase() else null
        if (explicitScheme != null && explicitScheme != "http" && explicitScheme != "https") return null

        val host = try {
            URI(if (explicitScheme == null) "http://$value" else value).host
        } catch (e: Exception) {
            null
        }
        if (host.isNullOrEmpty()) return null

        val local = LocalNetwork.isLocalHost(host)
        if (explicitScheme == "http" && !local) return null
        if (explicitScheme == null) value = "${if (local) "http" else "https"}://$value"
        return value
    }
}
