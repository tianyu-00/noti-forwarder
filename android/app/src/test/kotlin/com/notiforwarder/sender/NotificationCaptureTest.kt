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
    private var now = 5_000_000L
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
        queue = MessageQueue(db.queueDao()) { now }
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

    // Settings and SMS de-duplication are wired in for these tests.
    private var settings = CaptureSettings()
    private val smsDedupe = SmsDeduplicator()
    private val smsApp = "com.android.mms"

    private fun fullCapture() = NotificationCapture(
        parser = NotificationParser("com.notiforwarder.sender"),
        queue = queue,
        scheduler = scheduler,
        settings = { settings },
        dedupe = smsDedupe,
        smsPackages = { setOf(smsApp) },
        clock = { now },
    )

    private fun rawWithText(pkg: String, text: String) = raw(pkg).copy(text = text)

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

    @Test
    fun `the notifications switch turns off every notification`() {
        settings = CaptureSettings(sendNotifications = false)

        assertFalse(fullCapture().onNotification(raw()))

        assertEquals(0, queue.count())
        assertEquals(emptyList<String>(), flushRequests)
    }

    @Test
    fun `a blocked app is never queued, and other apps still are`() {
        settings = CaptureSettings(blockedApps = setOf("com.game"))

        fullCapture().onNotification(raw(pkg = "com.game"))
        fullCapture().onNotification(raw(pkg = "com.bank"))

        assertEquals(listOf("com.bank"), queue.nextBatch(10).map { it.message.app })
    }

    @Test
    fun `a notification from the sms app is dropped when it repeats a text we already captured`() {
        smsDedupe.recordSms("Your code is 123456")

        fullCapture().onNotification(rawWithText(smsApp, "Your code is 123456"))

        assertEquals(0, queue.count())
    }

    @Test
    fun `a notification from the sms app is stored at once but held back for a few seconds`() {
        assertTrue(fullCapture().onNotification(rawWithText(smsApp, "Hello from a friend")))

        assertEquals(1, queue.count()) // on disk immediately, so a crash cannot lose it
        assertEquals(emptyList<String>(), queue.nextBatch(10).map { it.message.body }) // but not due yet
        assertEquals(listOf("after 3000"), flushRequests)
        now += 3_000
        assertEquals(listOf("Hello from a friend"), queue.nextBatch(10).map { it.message.body })
    }

    @Test
    fun `the same text from another app is not treated as a duplicate`() {
        smsDedupe.recordSms("Your code is 123456")

        fullCapture().onNotification(rawWithText("com.whatsapp", "Your code is 123456"))

        assertEquals(listOf("com.whatsapp"), queue.nextBatch(10).map { it.message.app })
    }

    @Test
    fun `with sms turned off, the sms app's notifications are not leaked as notifications`() {
        settings = CaptureSettings(sendSms = false, sendNotifications = true)

        fullCapture().onNotification(rawWithText(smsApp, "Your code is 123456"))
        fullCapture().onNotification(rawWithText("com.bank", "A payment was made"))
        now += 3_000

        assertEquals(listOf("com.bank"), queue.nextBatch(10).map { it.message.app })
    }

    // What the service does with the notification afterwards: dismissing frees Android's
    // 50-notifications-per-app slot, but only for ones that are safe in the queue.

    @Test
    fun `a forwarded notification is reported as queued`() {
        assertEquals(CaptureOutcome.QUEUED, fullCapture().handle(raw()))
        assertEquals(1, queue.nextBatch(10).size)
    }

    @Test
    fun `a notification the user filtered out is reported as ignored, so it is never dismissed`() {
        settings = CaptureSettings(blockedApps = setOf("com.bank"))
        assertEquals(CaptureOutcome.IGNORED, fullCapture().handle(raw()))

        settings = CaptureSettings(sendNotifications = false)
        assertEquals(CaptureOutcome.IGNORED, fullCapture().handle(raw()))
    }

    @Test
    fun `an ongoing notification is ignored`() {
        assertEquals(CaptureOutcome.IGNORED, fullCapture().handle(raw(ongoing = true)))
    }

    @Test
    fun `a notification repeating an SMS we already have is reported as a copy`() {
        smsDedupe.recordSms("Your code is 123456")

        assertEquals(CaptureOutcome.COPY_OF_SMS, fullCapture().handle(rawWithText(smsApp, "Your code is 123456")))
        assertEquals(0, queue.nextBatch(10).size)
    }

    @Test
    fun `dismissing happens only when switched on and the notification is safe in the queue or a copy`() {
        val off = CaptureSettings(clearAfterForwarding = false)
        val on = CaptureSettings(clearAfterForwarding = true)

        assertFalse(off.shouldDismiss(CaptureOutcome.QUEUED))
        assertTrue(on.shouldDismiss(CaptureOutcome.QUEUED))
        assertTrue(on.shouldDismiss(CaptureOutcome.COPY_OF_SMS))
        assertFalse(on.shouldDismiss(CaptureOutcome.IGNORED))
    }
}
