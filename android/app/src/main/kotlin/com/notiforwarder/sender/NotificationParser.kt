package com.notiforwarder.sender

import java.time.Instant
import java.util.UUID

/**
 * Plain copy of the fields we need from Android's StatusBarNotification, so the
 * parsing rules can be unit tested on the JVM without the Android framework.
 */
data class RawNotification(
    val packageName: String,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val postTimeMillis: Long,
    val isOngoing: Boolean,
    val isGroupSummary: Boolean,
    val isForegroundService: Boolean,
)

/** A captured message in the shape the server expects (ids make retries idempotent). */
data class Message(
    val id: String,
    val type: String,
    val app: String,
    val sender: String,
    val body: String,
    val receivedAt: String,
)

class NotificationParser(
    private val ownPackage: String,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    /** Returns null for notifications that should never be forwarded. */
    fun parse(raw: RawNotification): Message? {
        if (raw.packageName == ownPackage) return null
        if (raw.isOngoing || raw.isForegroundService || raw.isGroupSummary) return null

        val title = raw.title?.trim().orEmpty()
        val body = listOf(raw.bigText, raw.text, raw.title)
            .map { it?.trim().orEmpty() }
            .firstOrNull { it.isNotEmpty() }
            ?: return null

        return Message(
            id = newId(),
            type = "notification",
            app = raw.packageName,
            sender = title,
            body = body,
            receivedAt = Instant.ofEpochMilli(raw.postTimeMillis).toString(),
        )
    }
}
