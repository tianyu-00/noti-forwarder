package com.notiforwarder.sender

enum class AlertMode { All, CodesOnly }

/** What a receiver alerts for. Applied on this phone, to messages it has already received. */
data class ReceiverSettings(
    val enabled: Boolean = true,
    val mode: AlertMode = AlertMode.All,
    /** "sms" and/or "notification". */
    val types: Set<String> = setOf("sms", "notification"),
    /** Packages whose notifications never alert. */
    val blockedApps: Set<String> = emptySet(),
)
