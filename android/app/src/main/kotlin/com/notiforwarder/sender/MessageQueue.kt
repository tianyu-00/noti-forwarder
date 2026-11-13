package com.notiforwarder.sender

enum class ActivityState { Waiting, Sent, Rejected }

/**
 * One line of the Activity tab: who a message was from, when, and how it stands. There is no text
 * here on purpose: the text of a sent message is erased from the phone.
 */
data class ActivityRow(
    val id: String,
    val type: String,
    val app: String,
    val sender: String,
    /** When it was sent, or for one still waiting, when it was captured. */
    val at: Long,
    val state: ActivityState,
)

/** A queued message plus how many times sending it has already failed. */
data class Queued(val message: Message, val attempts: Int)

/**
 * The offline queue. Every captured message is written here first and only removed
 * once the server confirms it, so nothing is lost while the phone is offline.
 * Blocking: call it off the main thread.
 */
class MessageQueue(
    private val dao: QueueDao,
    /** How many sent messages to remember for the Activity tab. */
    private val keepSent: Int = 50,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /**
     * False if a message with this id was already queued (the original is kept).
     * [notBefore] stores it now but keeps it from being sent until that time.
     */
    fun enqueue(message: Message, notBefore: Long = 0L): Boolean = dao.insert(
        QueuedMessage(
            id = message.id,
            type = message.type,
            app = message.app,
            sender = message.sender,
            body = message.body,
            receivedAt = message.receivedAt,
            enqueuedAt = clock(),
            nextAttemptAt = notBefore,
        ),
    ) != -1L

    /** The oldest messages that are due now, oldest first. */
    fun nextBatch(limit: Int): List<Queued> = dao.due(clock(), limit).map {
        Queued(Message(it.id, it.type, it.app, it.sender, it.body, it.receivedAt), it.attempts)
    }

    /**
     * Deletes queued notifications from [apps], queued since [since], whose text [isCopy] says
     * repeats a text message. Returns how many were removed.
     */
    fun removeNotificationCopies(apps: Set<String>, since: Long, isCopy: (String) -> Boolean): Int {
        if (apps.isEmpty()) return 0
        val ids = dao.notificationsFrom(apps.toList(), since).filter { isCopy(it.body) }.map { it.id }
        if (ids.isNotEmpty()) dao.delete(ids)
        return ids.size
    }

    /** The server has them. They stay as a short history (text erased) and are never sent again. */
    fun confirmed(ids: List<String>) {
        dao.markSent(ids, clock())
        dao.pruneSent(keepSent)
    }

    /** Newest first: what was sent, what is waiting, what the server refused. */
    fun recent(limit: Int): List<ActivityRow> = dao.recent(limit).map {
        ActivityRow(
            id = it.id,
            type = it.type,
            app = it.app,
            sender = it.sender,
            at = it.sentAt ?: it.enqueuedAt,
            state = when {
                it.sentAt != null -> ActivityState.Sent
                it.quarantined -> ActivityState.Rejected
                else -> ActivityState.Waiting
            },
        )
    }

    fun retryLater(ids: List<String>, atMillis: Long) = dao.retryLater(ids, atMillis)

    fun quarantine(id: String) = dao.quarantine(id)

    fun count(): Int = dao.count()

    fun quarantinedCount(): Int = dao.quarantinedCount()

    /** When the earliest waiting message becomes due, or null if nothing is waiting. */
    fun nextDueAt(): Long? = dao.nextDueAt(clock())
}
