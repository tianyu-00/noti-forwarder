package com.notiforwarder.sender

class InMemorySendStatus : SendStatus {
    private var last: Long? = null
    override fun lastSuccessAt() = last
    override fun recordSuccess(atMillis: Long) {
        last = atMillis
    }
}
