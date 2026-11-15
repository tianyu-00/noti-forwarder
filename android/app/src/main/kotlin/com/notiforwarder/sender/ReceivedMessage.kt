package com.notiforwarder.sender

import kotlinx.serialization.Serializable

/**
 * A message as the server holds it and sends it to a receiver. `sender` and `body` are still encrypted when the
 * sending phone paired with a key: they are kept that way on this phone too, and only read when shown.
 */
@Serializable
data class ReceivedMessage(
    val id: String,
    val deviceId: String,
    /** The sender phone's name, for the alert ("Kitchen phone"). Older servers do not send it. */
    val deviceName: String? = null,
    val type: String,
    val app: String,
    val appLabel: String? = null,
    val sender: String = "",
    val body: String,
    val receivedAt: String,
    /** The 2FA code the server found in a plain message; null for an encrypted one. */
    val code: String? = null,
)

/** Just enough of a stored message to compare it with the server's list. */
data class LocalRef(val id: String, val receivedAt: String)

/** What the user can read: the text after decrypting. [locked] is true when it could not be decrypted. */
data class ReadableMessage(val sender: String, val body: String, val code: String?, val locked: Boolean)
