package com.notiforwarder.sender

/**
 * One incoming SMS can fire both the SMS broadcast and a notification from the messaging app.
 * We keep the SMS (it has the real number) and drop the notification copy. This remembers
 * recent SMS texts so the notification can be recognised. In memory only: the two events
 * arrive within seconds of each other.
 */
class SmsDeduplicator(
    private val clock: () -> Long = System::currentTimeMillis,
    val windowMillis: Long = 2 * 60_000,
    private val maxEntries: Int = 100,
) {
    private data class Seen(val text: String, val at: Long)

    private val recent = ArrayDeque<Seen>()

    @Synchronized
    fun recordSms(body: String) {
        recent.addLast(Seen(normalize(body), clock()))
        while (recent.size > maxEntries) recent.removeFirst()
    }

    @Synchronized
    fun isDuplicateOfRecentSms(notificationText: String): Boolean {
        val now = clock()
        val candidate = normalize(notificationText)
        if (candidate.isEmpty()) return false
        // The window is deliberately short: the same code texted again later is a new message.
        return recent.any { now - it.at <= windowMillis && matches(candidate, it.text) }
    }

    /** True if [notificationText] looks like the messaging app's copy of the text [smsText]. */
    fun looksLikeCopy(notificationText: String, smsText: String): Boolean {
        val notification = normalize(notificationText)
        return notification.isNotEmpty() && matches(notification, normalize(smsText))
    }

    private fun matches(notification: String, sms: String): Boolean {
        if (notification == sms) return true
        // Notifications often cut long texts and add an ellipsis.
        val stripped = notification.removeSuffix("…").removeSuffix("...").trimEnd()
        return stripped.length >= MIN_PREFIX && stripped != notification && sms.startsWith(stripped)
    }

    private fun normalize(text: String) = text.trim().replace(Regex("\\s+"), " ")

    private companion object {
        const val MIN_PREFIX = 10
    }
}
