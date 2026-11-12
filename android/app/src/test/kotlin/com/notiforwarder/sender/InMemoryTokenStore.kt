package com.notiforwarder.sender

/** Test double: the real store is encrypted and only checked on a device. */
class InMemoryTokenStore(private var credentials: Credentials? = null) : TokenStore {
    override fun load() = credentials
    override fun save(credentials: Credentials) {
        this.credentials = credentials
    }
    override fun clear() {
        credentials = null
    }
}
