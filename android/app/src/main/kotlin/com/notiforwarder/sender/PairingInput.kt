package com.notiforwarder.sender

import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Where to pair and the single-use key to pair with. */
data class PairingTarget(val serverUrl: String, val code: String)

sealed interface PairingResult {
    data class Ok(val target: PairingTarget) : PairingResult
    data class Invalid(val reason: String) : PairingResult
}

@Serializable
private data class QrPayload(val u: String, val c: String)

object PairingInput {
    private val json = Json { ignoreUnknownKeys = true }

    /** Parses the text of the QR code shown on the web dashboard. */
    fun fromQr(text: String): PairingResult {
        val payload = try {
            json.decodeFromString<QrPayload>(text)
        } catch (e: Exception) {
            return PairingResult.Invalid("This is not a Notiforwarder pairing code.")
        }
        return build(payload.u, payload.c)
    }

    /** Validates the address and security key typed in by hand. */
    fun fromManual(address: String, key: String): PairingResult = build(address, key)

    private fun build(address: String, key: String): PairingResult {
        val server = normalizeServer(address)
            ?: return PairingResult.Invalid("Enter an https:// server address.")
        val code = key.trim()
        if (code.isEmpty()) return PairingResult.Invalid("Enter the security key.")
        return PairingResult.Ok(PairingTarget(server, code))
    }

    /** HTTPS only: the app refuses cleartext traffic. Returns null if unusable. */
    private fun normalizeServer(raw: String): String? {
        var value = raw.trim()
        if (value.isEmpty()) return null
        if ("://" in value) {
            if (!value.startsWith("https://", ignoreCase = true)) return null
        } else {
            value = "https://$value"
        }
        value = value.trimEnd('/')
        val host = try {
            URI(value).host
        } catch (e: Exception) {
            null
        }
        return if (host.isNullOrEmpty()) null else value
    }
}
