package com.notiforwarder.sender

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class NotificationCaptureTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private val flushRequests = mutableListOf<String>()
    private val scheduler = object : FlushScheduler {
        override fun flushSoon() {
            flushRequests += "soon"
        }
        override fun flushAfter(delayMillis: Long) {
            flushRequests += "after $delayMillis"
        }
    }

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao())
    }

    @After
    fun close() {
        db.close()
    }

    private fun raw(pkg: String = "com.bank", ongoing: Boolean = false) = RawNotification(
        packageName = pkg,
        title = "Bank",
        text = "Your code is 123456",
        bigText = null,
        postTimeMillis = 1_762_855_205_000L,
        isOngoing = ongoing,
        isGroupSummary = false,
        isForegroundService = false,
    )

    private fun capture() = NotificationCapture(NotificationParser("com.notiforwarder.sender"), queue, scheduler)

    @Test
    fun `writes the message to the queue first, then asks for a flush`() {
        assertTrue(capture().onNotification(raw()))

        assertEquals(1, queue.count())
        assertEquals("Your code is 123456", queue.nextBatch(10).single().message.body)
        assertEquals(listOf("soon"), flushRequests)
    }

    @Test
    fun `ignores notifications that should not be forwarded`() {
        assertFalse(capture().onNotification(raw(ongoing = true)))
        assertFalse(capture().onNotification(raw(pkg = "com.notiforwarder.sender")))

        assertEquals(0, queue.count())
        assertEquals(emptyList<String>(), flushRequests)
    }

    @Test
    fun `queues the message even when no flush can happen yet`() {
        // e.g. offline or unpaired: the scheduler just defers; the message is already safe.
        capture().onNotification(raw())
        capture().onNotification(raw())

        assertEquals(2, queue.count())
    }
}
