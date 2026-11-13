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

/** The queue keeps what it sent as a short history, for the Activity tab. */
@RunWith(RobolectricTestRunner::class)
class QueueHistoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private var now = 1_000_000L

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao(), keepSent = 3) { now }
    }

    @After
    fun close() {
        db.close()
    }

    private fun notification(id: String, app: String = "com.bank") =
        Message(id, "notification", app, "Title $id", "secret body $id", "2025-11-11T10:00:05Z")

    private fun sms(id: String, from: String = "NORTHWIND") =
        Message(id, "sms", "sms", from, "secret text $id", "2025-11-11T10:00:05Z")

    @Test
    fun `a confirmed message is no longer waiting but stays in the history as sent`() {
        queue.enqueue(notification("a"))
        now += 10
        queue.confirmed(listOf("a"))

        assertEquals(0, queue.count())
        assertTrue(queue.nextBatch(10).isEmpty())
        val row = queue.recent(10).single()
        assertEquals("a", row.id)
        assertEquals(ActivityState.Sent, row.state)
        assertEquals(now, row.at)
    }

    @Test
    fun `the text of a sent message is erased, only who it was from stays`() {
        queue.enqueue(sms("a", from = "NORTHWIND"))
        queue.confirmed(listOf("a"))

        db.openHelper.readableDatabase.query("SELECT body, sender FROM queued_messages WHERE id = 'a'").use {
            it.moveToFirst()
            assertEquals("", it.getString(0))
            assertEquals("NORTHWIND", it.getString(1))
        }
    }

    @Test
    fun `waiting messages show as waiting, with the time they were captured`() {
        queue.enqueue(notification("a"))

        val row = queue.recent(10).single()
        assertEquals(ActivityState.Waiting, row.state)
        assertEquals(now, row.at)
    }

    @Test
    fun `a message the server refused shows as rejected`() {
        queue.enqueue(notification("a"))
        queue.quarantine("a")

        assertEquals(ActivityState.Rejected, queue.recent(10).single().state)
    }

    @Test
    fun `lists the newest first, whether sent or waiting`() {
        queue.enqueue(notification("old"))
        now += 100
        queue.confirmed(listOf("old"))
        now += 100
        queue.enqueue(notification("new"))

        assertEquals(listOf("new", "old"), queue.recent(10).map { it.id })
    }

    @Test
    fun `respects the limit`() {
        for (id in listOf("a", "b", "c")) {
            queue.enqueue(notification(id))
            now += 10
        }

        assertEquals(listOf("c", "b"), queue.recent(2).map { it.id })
    }

    @Test
    fun `keeps only the newest few sent, and never drops one that is waiting`() {
        queue.enqueue(notification("waiting"))
        for (id in listOf("s1", "s2", "s3", "s4", "s5")) {
            now += 10
            queue.enqueue(notification(id))
            queue.confirmed(listOf(id))
        }

        val ids = queue.recent(100).map { it.id }
        assertEquals(listOf("s5", "s4", "s3", "waiting"), ids)
        assertEquals(1, queue.count())
    }

    @Test
    fun `sent rows are not rejected rows and do not count as quarantined`() {
        queue.enqueue(notification("a"))
        queue.enqueue(notification("b"))
        queue.quarantine("b")
        queue.confirmed(listOf("a"))

        assertEquals(1, queue.quarantinedCount())
        assertEquals(0, queue.count())
    }

    @Test
    fun `sent rows never set the next retry time`() {
        queue.enqueue(notification("a"))
        queue.confirmed(listOf("a"))

        assertEquals(null, queue.nextDueAt())
    }

    @Test
    fun `a notification replaced by its text message leaves the history too`() {
        queue.enqueue(notification("copy", app = "com.sms.app"))

        queue.removeNotificationCopies(setOf("com.sms.app"), since = 0) { true }

        assertTrue(queue.recent(10).isEmpty())
    }
}
