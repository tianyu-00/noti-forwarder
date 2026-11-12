package com.notiforwarder.sender

/** What the phone needs to talk to its server after pairing. */
data class Credentials(
    val serverUrl: String,
    val deviceId: String,
    val token: String,
    /** End-to-end encryption key from the pairing QR, or null when this phone sends plain text. */
    val e2eKey: String? = null,
)

/** The real implementation encrypts at rest; see EncryptedTokenStore. */
interface TokenStore {
    fun load(): Credentials?
    fun save(credentials: Credentials)
    fun clear()
}
