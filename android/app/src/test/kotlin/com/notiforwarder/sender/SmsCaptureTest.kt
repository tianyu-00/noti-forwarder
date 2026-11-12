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
        queue = MessageQueue(db.queueDao()) { now }
    }

    @After
    fun close() {
        db.close()
    }

    private var now = 9_000_000L
    private val smsApp = "com.android.mms"

    private fun capture() = SmsCapture(
        SmsParser(), queue, scheduler, { settings }, dedupe, smsPackages = { setOf(smsApp) }, clock = { now },
    )

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

    private fun heldNotification(app: String, body: String, id: String) = queue.enqueue(
        Message(id, "notification", app, "Mum", body, "2025-11-11T10:00:05Z"),
        notBefore = now + 3_000,
    )

    @Test
    fun `an sms that arrives while its notification copy is held removes the copy`() {
        heldNotification(smsApp, "Your code is 123456", "copy")

        capture().onSms(listOf(part("BANK", "Your code is 123456")))

        now += 3_000 // even once the hold has passed, only the sms is left to send
        assertEquals(listOf("sms"), queue.nextBatch(10).map { it.message.type })
    }

    @Test
    fun `an sms leaves notifications from other apps and different text alone`() {
        heldNotification("com.whatsapp", "Your code is 123456", "other-app")
        heldNotification(smsApp, "Different text", "other-text")

        capture().onSms(listOf(part("BANK", "Your code is 123456")))

        now += 3_000
        assertEquals(3, queue.nextBatch(10).size) // both notifications and the sms
    }
}
