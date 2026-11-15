package com.notiforwarder.sender

/**
 * Turns a stored message into readable text. An encrypted one is decrypted here with the key from pairing, so the
 * server never sees the text. Without the key, or with the wrong one, the message is "locked": it still counts as a
 * message, but shows no text. The stored message itself is never changed.
 */
class MessageReader(private val key: () -> String?) {
    private val locked = ReadableMessage(sender = "", body = "", code = null, locked = true)

    fun read(message: ReceivedMessage): ReadableMessage {
        val sealed = message.body.startsWith(E2eCipher.PREFIX) || message.sender.startsWith(E2eCipher.PREFIX)
        if (!sealed) {
            return ReadableMessage(message.sender, message.body, message.code ?: CodeExtractor.extract(message.body), false)
        }
        val keyText = key() ?: return locked
        return try {
            val cipher = E2eCipher(keyText)
            fun open(field: String, value: String) = if (value.startsWith(E2eCipher.PREFIX)) cipher.decrypt(field, value) else value
            val body = open("body", message.body)
            ReadableMessage(open("sender", message.sender), body, CodeExtractor.extract(body), false)
        } catch (e: Exception) {
            locked
        }
    }
}
