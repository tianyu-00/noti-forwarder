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
class RoomReceivedStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var db: AppDatabase
    private lateinit var store: RoomReceivedStore

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        store = RoomReceivedStore(db.receivedDao(), keep = 5)
    }

    @After
    fun close() {
        db.close()
    }

    private fun m(n: Int, device: String = "d1") = ReceivedMessage(
        id = "m$n", deviceId = device, deviceName = "Kitchen", type = "sms", app = "sms", appLabel = null,
        sender = "e2e:v1:AA$n", body = "e2e:v1:BB$n", receivedAt = "2026-11-11T10:00:%02d.000Z".format(n), code = null,
    )

    @Test
    fun `keeps what it is given exactly as received, still encrypted`() {
        store.insert(listOf(m(1)))

        val back = store.recent(10).single()

        assertEquals(m(1), back)
        assertTrue(back.body.startsWith("e2e:v1:"))
    }

    @Test
    fun `lists the newest first`() {
        store.insert(listOf(m(2), m(3), m(1)))

        assertEquals(listOf("m3", "m2", "m1"), store.recent(10).map { it.id })
        assertEquals(listOf("m3", "m2"), store.recent(2).map { it.id })
    }

    @Test
    fun `a message stored twice is stored once`() {
        store.insert(listOf(m(1)))
        store.insert(listOf(m(1)))

        assertEquals(1, store.allIds().size)
    }

    @Test
    fun `knows what it holds, for comparing with the server`() {
        store.insert(listOf(m(1), m(2)))

        assertTrue(store.contains("m1"))
        assertFalse(store.contains("m9"))
        assertEquals(setOf(LocalRef("m1", "2026-11-11T10:00:01.000Z"), LocalRef("m2", "2026-11-11T10:00:02.000Z")), store.refs().toSet())
    }

    @Test
    fun `deletes by id, and by phone`() {
        store.insert(listOf(m(1, "d1"), m(2, "d2"), m(3, "d1")))

        assertEquals(setOf("m1", "m3"), store.idsForDevice("d1").toSet())
        store.delete(listOf("m1"))
        store.delete(store.idsForDevice("d2"))

        assertEquals(listOf("m3"), store.allIds())
    }

    @Test
    fun `keeps only the newest few, so the history never grows without end`() {
        store.insert((1..8).map { m(it) })

        assertEquals(listOf("m8", "m7", "m6", "m5", "m4"), store.recent(100).map { it.id })
    }
}
