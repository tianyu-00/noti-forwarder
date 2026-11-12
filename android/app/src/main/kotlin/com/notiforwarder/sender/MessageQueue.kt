package com.notiforwarder.sender

/** A queued message plus how many times sending it has already failed. */
data class Queued(val message: Message, val attempts: Int)

/**
 * The offline queue. Every captured message is written here first and only removed
 * once the server confirms it, so nothing is lost while the phone is offline.
 * Blocking: call it off the main thread.
 */
class MessageQueue(
    private val dao: QueueDao,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** False if a message with this id was already queued (the original is kept). */
    fun enqueue(message: Message): Boolean = dao.insert(
        QueuedMessage(
            id = message.id,
            type = message.type,
            app = message.app,
            sender = message.sender,
            body = message.body,
            receivedAt = message.receivedAt,
            enqueuedAt = clock(),
        ),
    ) != -1L

    /** The oldest messages that are due now, oldest first. */
    fun nextBatch(limit: Int): List<Queued> = dao.due(clock(), limit).map {
        Queued(Message(it.id, it.type, it.app, it.sender, it.body, it.receivedAt), it.attempts)
    }

    fun confirmed(ids: List<String>) = dao.delete(ids)

    fun retryLater(ids: List<String>, atMillis: Long) = dao.retryLater(ids, atMillis)

    fun quarantine(id: String) = dao.quarantine(id)

    fun count(): Int = dao.count()

    fun quarantinedCount(): Int = dao.quarantinedCount()

    /** When the earliest waiting message becomes due, or null if nothing is waiting. */
    fun nextDueAt(): Long? = dao.nextDueAt(clock())
}
