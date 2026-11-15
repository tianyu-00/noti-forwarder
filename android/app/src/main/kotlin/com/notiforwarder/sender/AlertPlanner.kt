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

object AlertPlanner {
    /** Null means: do not alert (the user's rules say no). */
    fun plan(message: ReceivedMessage, read: ReadableMessage, settings: ReceiverSettings): AlertPlan? {
        if (!settings.enabled) return null
        if (message.type !in settings.types) return null
        if (message.app in settings.blockedApps) return null
        if (settings.mode == AlertMode.CodesOnly && (read.locked || read.code == null)) return null

        val d = MessageDescriber.describe(message, read)
        return AlertPlan(message.id, d.title, d.text, d.device, high = d.code != null, code = d.code)
    }
}
