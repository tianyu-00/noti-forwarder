package com.notiforwarder.sender

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable

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
@Serializable
data class Message(
    val id: String,
    val type: String,
    val app: String,
    val sender: String,
    val body: String,
    val receivedAt: String,
    /** The app's real name ("Gmail"), added just before sending. Null (and left out) when unknown. */
    val appLabel: String? = null,
    /** The SIM (its subscription id) that received a text. Null for notifications and when Android did not say. */
    val sim: Int? = null,
)

class NotificationParser(
    private val ownPackage: String,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    // The signed app and the dev build (".debug") are two apps that can sit on one phone: neither forwards the other's
    // notifications, which are alerts carrying message text and 2FA codes.
    private val ownFamily = ownPackage.removeSuffix(".debug")

    /** Returns null for notifications that should never be forwarded. */
    fun parse(raw: RawNotification): Message? {
        if (raw.packageName == ownFamily || raw.packageName == "$ownFamily.debug") return null
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
