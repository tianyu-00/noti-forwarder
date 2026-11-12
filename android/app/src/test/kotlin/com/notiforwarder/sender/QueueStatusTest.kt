package com.notiforwarder.sender

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class QueueStatusTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private val sendStatus = InMemorySendStatus()

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao())
    }

    @After
    fun close() {
        db.close()
    }

    private fun enqueue(id: String) =
        queue.enqueue(Message(id, "notification", "com.bank", "Bank", "body", "2025-11-11T10:00:05Z"))

    @Test
    fun `reports how many messages are waiting, quarantined, and when the last send worked`() {
        enqueue("a")
        enqueue("b")
        enqueue("bad")
        queue.quarantine("bad")
        sendStatus.recordSuccess(123_000L)

        val snapshot = StatusReader(queue, sendStatus).snapshot()

        assertEquals(QueueStatus(queued = 2, quarantined = 1, lastSuccessAt = 123_000L), snapshot)
    }

    @Test
    fun `a fresh install has nothing queued and no send yet`() {
        assertEquals(QueueStatus(0, 0, null), StatusReader(queue, sendStatus).snapshot())
    }
}
