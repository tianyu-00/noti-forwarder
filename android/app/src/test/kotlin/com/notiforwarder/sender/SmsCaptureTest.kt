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
class SmsCaptureTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var queue: MessageQueue
    private val flushes = mutableListOf<String>()
    private val scheduler = object : FlushScheduler {
        override fun flushSoon() {
            flushes += "soon"
        }
        override fun flushAfter(delayMillis: Long) {
            flushes += "after $delayMillis"
        }
    }
    private var settings = CaptureSettings()
    private val dedupe = SmsDeduplicator()

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        queue = MessageQueue(db.queueDao())
    }

    @After
    fun close() {
        db.close()
    }

    private fun capture() = SmsCapture(SmsParser(), queue, scheduler, { settings }, dedupe)

    private fun part(address: String, body: String) = RawSmsPart(address, body, 1_762_855_205_000L)

    @Test
    fun `queues an incoming text first, then asks for a flush`() {
        val count = capture().onSms(listOf(part("BANK", "Your code is 123456")))

        assertEquals(1, count)
        val queued = queue.nextBatch(10).single().message
        assertEquals("sms", queued.type)
        assertEquals("BANK", queued.sender)
        assertEquals("Your code is 123456", queued.body)
        assertEquals(listOf("soon"), flushes)
    }

    @Test
    fun `queues nothing and asks for no flush when sms is turned off`() {
        settings = CaptureSettings(sendSms = false)

        assertEquals(0, capture().onSms(listOf(part("BANK", "Your code is 123456"))))

        assertEquals(0, queue.count())
        assertEquals(emptyList<String>(), flushes)
    }

    @Test
    fun `remembers the text so its notification copy can be dropped`() {
        capture().onSms(listOf(part("BANK", "Your code is 123456")))

        assertTrue(dedupe.isDuplicateOfRecentSms("Your code is 123456"))
    }

    @Test
    fun `an sms turned off leaves no trace to match against`() {
        settings = CaptureSettings(sendSms = false)

        capture().onSms(listOf(part("BANK", "Your code is 123456")))

        assertFalse(dedupe.isDuplicateOfRecentSms("Your code is 123456"))
    }

    @Test
    fun `queues each separate text from a batch`() {
        val count = capture().onSms(listOf(part("BANK", "one"), part("MUM", "two")))

        assertEquals(2, count)
        assertEquals(2, queue.count())
    }
}
