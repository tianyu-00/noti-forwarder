package com.notiforwarder.sender

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MessageQueueTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private var now = 1_000_000L

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao()) { now }
    }

    @After
    fun close() {
        db.close()
    }

    private fun msg(id: String, body: String = "body $id") =
        Message(id, "notification", "com.bank", "Bank", body, "2025-11-11T10:00:05Z")

    private fun ids(limit: Int = 100) = queue.nextBatch(limit).map { it.message.id }

    @Test
    fun `enqueue stores the message so it can be sent later`() {
        assertTrue(queue.enqueue(msg("a", body = "Your code is 123456")))

        val queued = queue.nextBatch(10).single()
        assertEquals(msg("a", body = "Your code is 123456"), queued.message)
        assertEquals(0, queued.attempts)
        assertEquals(1, queue.count())
    }

    @Test
    fun `the same id is stored once`() {
        assertTrue(queue.enqueue(msg("a", body = "first")))
        assertFalse(queue.enqueue(msg("a", body = "second")))

        assertEquals(1, queue.count())
        assertEquals("first", queue.nextBatch(10).single().message.body)
    }

    @Test
    fun `hands out the oldest messages first and respects the limit`() {
        for (id in listOf("a", "b", "c", "d")) {
            queue.enqueue(msg(id))
            now += 10
        }

        assertEquals(listOf("a", "b"), ids(limit = 2))
        assertEquals(listOf("a", "b", "c", "d"), ids())
    }

    @Test
    fun `messages enqueued in the same millisecond keep their order`() {
        for (id in listOf("a", "b", "c")) queue.enqueue(msg(id)) // the clock never moves

        assertEquals(listOf("a", "b", "c"), ids())
    }

    @Test
    fun `only confirmed messages are deleted`() {
        for (id in listOf("a", "b", "c")) queue.enqueue(msg(id))

        queue.confirmed(listOf("a", "c"))

        assertEquals(listOf("b"), ids())
        assertEquals(1, queue.count())
    }

    @Test
    fun `a failed message waits until its retry time and counts the attempt`() {
        queue.enqueue(msg("a"))
        queue.enqueue(msg("b"))

        queue.retryLater(listOf("a"), atMillis = now + 60_000)

        assertEquals(listOf("b"), ids())
        now += 59_999
        assertEquals(listOf("b"), ids())
        now += 1
        val back = queue.nextBatch(10)
        assertEquals(listOf("a", "b"), back.map { it.message.id })
        assertEquals(1, back.first { it.message.id == "a" }.attempts)
        assertEquals(0, back.first { it.message.id == "b" }.attempts)
    }

    @Test
    fun `reports when the next waiting message becomes due`() {
        assertNull(queue.nextDueAt())
        queue.enqueue(msg("a"))
        assertNull(queue.nextDueAt()) // already due, nothing to wait for

        queue.retryLater(listOf("a"), atMillis = now + 90_000)
        queue.enqueue(msg("b"))
        queue.retryLater(listOf("b"), atMillis = now + 30_000)

        assertEquals(now + 30_000, queue.nextDueAt())
    }

    @Test
    fun `a quarantined message is kept but never handed out again`() {
        queue.enqueue(msg("bad"))
        queue.enqueue(msg("good"))

        queue.quarantine("bad")

        assertEquals(listOf("good"), ids())
        assertEquals(1, queue.count())
        assertEquals(1, queue.quarantinedCount())
        now += 24 * 60 * 60 * 1000
        assertEquals(listOf("good"), ids())
    }

    @Test
    fun `messages survive the app being killed and restarted`() {
        val name = "durable-${UUID.randomUUID()}.db"
        val first = Room.databaseBuilder(context, AppDatabase::class.java, name).allowMainThreadQueries().build()
        MessageQueue(first.queueDao()) { now }.enqueue(msg("a", body = "written before the crash"))
        first.close()

        val second = Room.databaseBuilder(context, AppDatabase::class.java, name).allowMainThreadQueries().build()
        val restored = MessageQueue(second.queueDao()) { now }.nextBatch(10)
        second.close()
        context.deleteDatabase(name)

        assertEquals("written before the crash", restored.single().message.body)
    }

    @Test
    fun `a message can be queued now but not become due for a while`() {
        queue.enqueue(msg("held"), notBefore = now + 3_000)
        queue.enqueue(msg("now"))

        assertEquals(2, queue.count()) // safely stored right away
        assertEquals(listOf("now"), ids())
        now += 3_000
        assertEquals(listOf("held", "now").sorted(), ids().sorted())
    }

    private fun notification(id: String, app: String, body: String) =
        Message(id, "notification", app, "Sender", body, "2025-11-11T10:00:05Z")

    @Test
    fun `removes queued notification copies of an sms, but only from the given apps and with matching text`() {
        queue.enqueue(notification("copy", "com.android.mms", "Your code is 123456"))
        queue.enqueue(notification("other-text", "com.android.mms", "Something else"))
        queue.enqueue(notification("other-app", "com.whatsapp", "Your code is 123456"))
        queue.enqueue(msg("sms").copy(type = "sms", app = "sms", body = "Your code is 123456"))

        val removed = queue.removeNotificationCopies(setOf("com.android.mms"), since = 0) { it == "Your code is 123456" }

        assertEquals(1, removed)
        assertEquals(listOf("other-text", "other-app", "sms"), ids())
    }

    @Test
    fun `only recent notifications can be copies of a new sms`() {
        queue.enqueue(notification("old", "com.android.mms", "Your code is 123456"))
        now += 10 * 60_000
        queue.enqueue(notification("recent", "com.android.mms", "Your code is 123456"))

        queue.removeNotificationCopies(setOf("com.android.mms"), since = now - 2 * 60_000) { true }

        assertEquals(listOf("old"), ids())
    }
}
