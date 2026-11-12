package com.notiforwarder.sender

/** Something that can deliver a batch to the server (the real one is MessageSender). */
fun interface BatchSender {
    fun send(messages: List<Message>): SendOutcome
}

/** Remembers the last successful send, for the status screen. */
interface SendStatus {
    fun lastSuccessAt(): Long?
    fun recordSuccess(atMillis: Long)
}

sealed interface FlushResult {
    /** Everything that can be sent has been sent. */
    data object Drained : FlushResult

    /** Try again after this many milliseconds. */
    data class RetryAfter(val delayMillis: Long) : FlushResult

    /** Not paired or revoked: do not retry until pairing changes. Nothing was dropped. */
    data object Blocked : FlushResult
}

/**
 * Sends the queue to the server. A message leaves the queue only after the server confirms it,
 * so a crash, a dropped connection or a revoked phone never loses anything.
 * Blocking: call it off the main thread.
 */
class Flusher(
    private val queue: MessageQueue,
    private val sender: BatchSender,
    private val status: SendStatus,
    private val backoff: Backoff = Backoff(),
    private val batchSize: Int = 50,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun flush(): FlushResult {
        while (true) {
            val batch = queue.nextBatch(batchSize)
            if (batch.isEmpty()) return waitingOrDrained()

            val ids = batch.map { it.message.id }
            when (trySend(batch.map { it.message })) {
                is SendOutcome.Sent -> confirm(ids)
                SendOutcome.NotPaired, SendOutcome.Unauthorized -> return FlushResult.Blocked
                SendOutcome.Rejected ->
                    if (batch.size == 1) queue.quarantine(ids.single()) else splitUp(batch)?.let { return it }
                else -> return failed(batch)
            }
        }
    }

    private fun confirm(ids: List<String>) {
        queue.confirmed(ids)
        status.recordSuccess(clock())
    }

    /** One bad message must not block the rest: send them one at a time to find it. */
    private fun splitUp(batch: List<Queued>): FlushResult? {
        for ((index, queued) in batch.withIndex()) {
            when (trySend(listOf(queued.message))) {
                is SendOutcome.Sent -> confirm(listOf(queued.message.id))
                SendOutcome.Rejected -> queue.quarantine(queued.message.id)
                SendOutcome.NotPaired, SendOutcome.Unauthorized -> return FlushResult.Blocked
                else -> return failed(batch.drop(index))
            }
        }
        return null
    }

    private fun failed(batch: List<Queued>): FlushResult {
        val delay = backoff.delayMillis(batch.maxOf { it.attempts } + 1)
        queue.retryLater(batch.map { it.message.id }, clock() + delay)
        return FlushResult.RetryAfter(delay)
    }

    private fun waitingOrDrained(): FlushResult {
        val next = queue.nextDueAt() ?: return FlushResult.Drained
        return FlushResult.RetryAfter((next - clock()).coerceAtLeast(0))
    }

    // Whatever goes wrong, the messages stay queued and the flush is retried later.
    private fun trySend(messages: List<Message>): SendOutcome =
        try {
            sender.send(messages)
        } catch (e: Exception) {
            SendOutcome.Unreachable("unexpected error: ${e::class.simpleName}")
        }
}
