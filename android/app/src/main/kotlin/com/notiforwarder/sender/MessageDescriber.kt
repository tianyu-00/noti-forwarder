package com.notiforwarder.sender

/** How a message reads in a list or an alert. */
data class Described(
    /** Where it came from: "SMS from BANK", "Gmail: Run failed". */
    val source: String,
    /** The source, with the 2FA code in front when there is one. */
    val title: String,
    val text: String,
    /** The sender phone it came to ("Kitchen phone"), or null when the server did not say. */
    val device: String?,
    val code: String?,
    val locked: Boolean,
)

private const val MAX_TEXT = 1000

object MessageDescriber {
    fun describe(message: ReceivedMessage, read: ReadableMessage): Described {
        val device = message.deviceName?.takeIf { it.isNotBlank() }
        if (read.locked) {
            return Described("New message", "New message", "Add the encryption key to read it.", device, code = null, locked = true)
        }
        val source = if (message.type == "sms") {
            "SMS from ${read.sender.ifBlank { "unknown number" }}"
        } else {
            val name = message.appLabel?.takeIf { it.isNotBlank() } ?: message.app
            if (read.sender.isNotBlank()) "$name: ${read.sender}" else name
        }
        val text = if (read.body.length > MAX_TEXT) read.body.take(MAX_TEXT) + "…" else read.body
        return Described(source, read.code?.let { "🔑 $it · $source" } ?: source, text, device, read.code, locked = false)
    }
}

/** An app that has sent notifications through a sender phone. */
data class SeenApp(val packageName: String, val name: String)

/**
 * The apps the user can turn off. The receiver phone does not have the sender's apps installed, so the list is made
 * from the notifications it has received. Texts are not an app.
 */
fun appsSeen(messages: List<ReceivedMessage>): List<SeenApp> {
    val names = linkedMapOf<String, String>()
    for (m in messages) {
        if (m.type != "notification") continue
        val known = m.appLabel?.takeIf { it.isNotBlank() }
        // Keep a real name once one has been seen; the package name is only the fallback.
        if (known != null || m.app !in names) names[m.app] = known ?: names[m.app] ?: m.app
    }
    return names.map { (pkg, name) -> SeenApp(pkg, name) }.sortedBy { it.name.lowercase() }
}
