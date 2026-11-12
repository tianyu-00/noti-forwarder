package com.notiforwarder.sender

/** What the phone needs to talk to its server after pairing. */
data class Credentials(val serverUrl: String, val deviceId: String, val token: String)

/** The real implementation encrypts at rest; see EncryptedTokenStore. */
interface TokenStore {
    fun load(): Credentials?
    fun save(credentials: Credentials)
    fun clear()
}
