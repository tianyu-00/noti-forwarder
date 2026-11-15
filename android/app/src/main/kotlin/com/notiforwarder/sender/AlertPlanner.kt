package com.notiforwarder.sender

/** What to show for one message. [key] is stable per message, so deleting the message can remove its notification. */
data class AlertPlan(
    val key: String,
    val title: String,
    val text: String,
    val subText: String?,
    val high: Boolean,
    val code: String?,
)

private const val MAX_TEXT = 1000

object AlertPlanner {
    /** Null means: do not alert (the user's rules say no). */
    fun plan(message: ReceivedMessage, read: ReadableMessage, settings: ReceiverSettings): AlertPlan? {
        if (!settings.enabled) return null
        if (message.type !in settings.types) return null
        if (message.app in settings.blockedApps) return null
        if (settings.mode == AlertMode.CodesOnly && (read.locked || read.code == null)) return null

        val device = message.deviceName?.takeIf { it.isNotBlank() }
        if (read.locked) {
            return AlertPlan(message.id, "New message", "Add the encryption key to read it.", device, high = false, code = null)
        }
        val source = if (message.type == "sms") {
            "SMS from ${read.sender.ifBlank { "unknown number" }}"
        } else {
            val name = message.appLabel?.takeIf { it.isNotBlank() } ?: message.app
            if (read.sender.isNotBlank()) "$name: ${read.sender}" else name
        }
        val text = if (read.body.length > MAX_TEXT) read.body.take(MAX_TEXT) + "…" else read.body
        return AlertPlan(
            key = message.id,
            title = read.code?.let { "🔑 $it · $source" } ?: source,
            text = text,
            subText = device,
            high = read.code != null,
            code = read.code,
        )
    }
}
