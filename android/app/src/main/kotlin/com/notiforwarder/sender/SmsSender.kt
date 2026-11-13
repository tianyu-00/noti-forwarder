package com.notiforwarder.sender

sealed interface SmsResult {
    data object Sent : SmsResult

    /** [code] is a short reason such as "no_service", never text from the message. */
    data class Failed(val code: String) : SmsResult
}

/** Sends one text from this phone. A seam around Android's SmsManager, so the logic is tested without a radio. */
interface SmsSender {
    fun send(to: String, text: String): SmsResult
}
