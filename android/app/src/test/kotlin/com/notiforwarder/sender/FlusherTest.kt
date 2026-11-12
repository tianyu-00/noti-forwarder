package com.notiforwarder.sender

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FlusherTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private val status = InMemorySendStatus()
    private var now = 10_000_000L

    /** What the "server" answers, and every batch it was asked to send. */
    private var respond: (List<Message>) -> SendOutcome = { SendOutcome.Sent(it.size, 0) }
    private val sentBatches = mutableListOf<List<String>>()

    // random = 0.5 removes jitter, so delays are exactly 15s, 30s, 60s...
    private val backoff = Backoff(baseMillis = 15_000, maxMillis = 900_000, jitter = 0.2, random = { 0.5 })

    private fun flusher(batchSize: Int = 50) = Flusher(
        queue = queue,
        sender = { messages ->
            sentBatches += messages.map { it.id }
            respond(messages)
        },
        status = status,
        backoff = backoff,
        batchSize = batchSize,
        clock = { now },
    )

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao()) { now }
    }

    @After
    fun close() {
        db.close()
    }

    private fun enqueue(vararg ids: String) = ids.forEach {
        queue.enqueue(Message(it, "notification", "com.bank", "Bank", "body $it", "2025-11-11T10:00:05Z"))
    }

    @Test
    fun `does nothing when the queue is empty`() {
        assertEquals(FlushResult.Drained, flusher().flush())
        assertTrue(sentBatches.isEmpty())
    }

    @Test
    fun `sends the queued messages and deletes them once the server confirms`() {
        enqueue("a", "b")

        val result = flusher().flush()

        assertEquals(FlushResult.Drained, result)
        assertEquals(listOf(listOf("a", "b")), sentBatches)
        assertEquals(0, queue.count())
        assertEquals(now, status.lastSuccessAt())
    }

    @Test
    fun `messages are still in the queue while the send is in flight`() {
        enqueue("a")
        var countDuringSend = -1
        respond = {
            countDuringSend = queue.count()
            SendOutcome.Sent(1, 0)
        }

        flusher().flush()

        assertEquals(1, countDuringSend)
    }

    @Test
    fun `drains a long queue in order, one batch at a time`() {
        val all = (1..120).map { "m%03d".format(it) }
        enqueue(*all.toTypedArray())

        flusher(batchSize = 50).flush()

        assertEquals(listOf(50, 50, 20), sentBatches.map { it.size })
        assertEquals(all, sentBatches.flatten())
        assertEquals(0, queue.count())
    }

    @Test
    fun `a resend after a crash is fine, the server just reports duplicates`() {
        enqueue("a")
        respond = { SendOutcome.Sent(stored = 0, duplicates = it.size) }

        assertEquals(FlushResult.Drained, flusher().flush())
        assertEquals(0, queue.count())
    }

    @Test
    fun `temporary failures keep every message and ask to retry after a backoff`() {
        for (failure in listOf(SendOutcome.Unreachable("offline"), SendOutcome.ServerError(503), SendOutcome.RateLimited)) {
            db.clearAllTables()
            enqueue("a", "b")
            respond = { failure }

            val result = flusher().flush()

            assertEquals("for $failure", FlushResult.RetryAfter(15_000), result)
            assertEquals(2, queue.count())
            assertEquals(null, status.lastSuccessAt())
        }
    }

    @Test
    fun `waits out the backoff, then retries, and backs off further if it fails again`() {
        enqueue("a")
        respond = { SendOutcome.Unreachable("offline") }
        assertEquals(FlushResult.RetryAfter(15_000), flusher().flush())

        now += 5_000 // too early: nothing is due, and it says how long is left
        sentBatches.clear()
        assertEquals(FlushResult.RetryAfter(10_000), flusher().flush())
        assertTrue(sentBatches.isEmpty())

        now += 10_000
        assertEquals(FlushResult.RetryAfter(30_000), flusher().flush()) // second failure: doubled
        assertEquals(1, sentBatches.size)
        assertEquals(1, queue.count())

        respond = { SendOutcome.Sent(it.size, 0) }
        now += 30_000
        assertEquals(FlushResult.Drained, flusher().flush())
        assertEquals(0, queue.count())
    }

    @Test
    fun `stops without retrying when the phone is revoked or not paired, and keeps everything`() {
        for (blocked in listOf(SendOutcome.Unauthorized, SendOutcome.NotPaired)) {
            db.clearAllTables()
            enqueue("a", "b")
            respond = { blocked }

            assertEquals("for $blocked", FlushResult.Blocked, flusher().flush())
            assertEquals(2, queue.count())
            assertEquals(0, queue.quarantinedCount())
        }
    }

    @Test
    fun `a payload the server rejects is split up so one bad message cannot block the rest`() {
        enqueue("good1", "bad", "good2")
        respond = { messages ->
            if (messages.any { it.id == "bad" }) SendOutcome.Rejected else SendOutcome.Sent(messages.size, 0)
        }

        val result = flusher().flush()

        assertEquals(FlushResult.Drained, result)
        assertEquals(0, queue.count()) // good ones delivered
        assertEquals(1, queue.quarantinedCount()) // bad one kept, not deleted, not retried
        assertEquals(now, status.lastSuccessAt())
    }

    @Test
    fun `a lone rejected message is quarantined, never deleted`() {
        enqueue("bad")
        respond = { SendOutcome.Rejected }

        assertEquals(FlushResult.Drained, flusher().flush())

        assertEquals(0, queue.count())
        assertEquals(1, queue.quarantinedCount())
        sentBatches.clear()
        now += 24 * 60 * 60 * 1000
        flusher().flush()
        assertTrue(sentBatches.isEmpty()) // never retried
    }

    @Test
    fun `losing authorization halfway through splitting keeps the unsent messages`() {
        enqueue("a", "b", "c")
        var calls = 0
        respond = {
            calls++
            when {
                it.size > 1 -> SendOutcome.Rejected
                calls == 2 -> SendOutcome.Sent(1, 0) // "a" goes through
                else -> SendOutcome.Unauthorized // then the phone is revoked
            }
        }

        assertEquals(FlushResult.Blocked, flusher().flush())

        assertEquals(listOf("b", "c"), queue.nextBatch(10).map { it.message.id })
        assertEquals(0, queue.quarantinedCount())
    }

    @Test
    fun `an unexpected crash while sending keeps the messages and asks to retry`() {
        enqueue("a")
        respond = { error("malformed response") }

        assertEquals(FlushResult.RetryAfter(15_000), flusher().flush())
        assertEquals(1, queue.count())
    }
}
