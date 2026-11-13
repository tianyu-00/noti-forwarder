package com.notiforwarder.sender

sealed interface SmsResult {
    data object Sent : SmsResult

    /** [code] is a short reason such as "no_service", never text from the message. */
    data class Failed(val code: String) : SmsResult
}

/** Sends one text from this phone. A seam around Android's SmsManager, so the logic is tested without a radio. */
interface SmsSender {
    /** [subscriptionId] picks the SIM; null means the phone's default. */
    fun send(to: String, text: String, subscriptionId: Int? = null): SmsResult
}

/** One SIM in the phone, as the user sees it ("SIM 1 · China Mobile"). */
data class SimOption(val id: Int, val label: String)
