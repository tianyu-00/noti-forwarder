package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeApi(var outcome: RecentOutcome = RecentOutcome.Messages(emptyList())) : ReceiverApi {
    override fun recent(limit: Int) = outcome
}

private class FakeStore : ReceivedStore {
    val rows = linkedMapOf<String, ReceivedMessage>()
    override fun refs() = rows.values.map { LocalRef(it.id, it.receivedAt) }
    override fun insert(messages: List<ReceivedMessage>) = messages.forEach { rows[it.id] = it }
    override fun delete(ids: List<String>) = ids.forEach { rows.remove(it) }
    override fun idsForDevice(deviceId: String) = rows.values.filter { it.deviceId == deviceId }.map { it.id }
    override fun allIds() = rows.keys.toList()
    override fun contains(id: String) = id in rows
}

private class FakeAlerts : AlertSink {
    val shown = mutableListOf<AlertPlan>()
    val statuses = mutableListOf<StatusPlan>()
    val cancelled = mutableListOf<String>()
    var cancelledAll = 0
    override fun show(plan: AlertPlan) {
        shown += plan
    }
    override fun showStatus(plan: StatusPlan) {
        statuses += plan
    }
    override fun cancel(keys: List<String>) {
        cancelled += keys
    }
    override fun cancelAll() {
        cancelledAll++
    }
}

private class FakeState(override var seeded: Boolean = false) : SyncState

class ReceiverEngineTest {
    private val api = FakeApi()
    private val store = FakeStore()
    private val alerts = FakeAlerts()
    private val state = FakeState()
    private var settings = ReceiverSettings()

    private fun engine(window: Int = 100, maxAlerts: Int = 5) =
        ReceiverEngine(api, store, alerts, { settings }, MessageReader { null }, state, window, maxAlerts)

    private fun m(n: Int, device: String = "d1", type: String = "sms", app: String = "sms") = ReceivedMessage(
        id = "m$n", deviceId = device, deviceName = "Kitchen", type = type, app = app, appLabel = null,
        sender = "BANK", body = "text $n", receivedAt = "2026-11-11T10:00:%02d.000Z".format(n), code = null,
    )

    private fun json(m: ReceivedMessage) =
        """{"id":"${m.id}","deviceId":"${m.deviceId}","deviceName":"${m.deviceName}","type":"${m.type}","app":"${m.app}","appLabel":null,"sender":"${m.sender}","body":"${m.body}","receivedAt":"${m.receivedAt}","createdAt":"2026-11-11T10:00:09.000Z","code":null,"sim":null}"""

    private fun serverHas(vararg n: Int) {
        api.outcome = RecentOutcome.Messages(n.sortedDescending().map { m(it) })
    }

    // --- the first sync after pairing: history appears without a burst of alerts ---

    @Test
    fun `the first sync stores the history and stays silent, then remembers it has done so`() {
        serverHas(1, 2, 3)

        assertEquals(SyncResult.Ok, engine().sync())

        assertEquals(setOf("m1", "m2", "m3"), store.rows.keys)
        assertTrue(alerts.shown.isEmpty())
        assertTrue(state.seeded)
    }

    @Test
    fun `later syncs alert for messages that arrived while the phone was away, oldest first`() {
        state.seeded = true
        store.insert(listOf(m(1)))
        serverHas(1, 2, 3)

        engine().sync()

        assertEquals(listOf("m2", "m3"), alerts.shown.map { it.key })
    }

    @Test
    fun `a pile that arrived while away does not become a pile of alerts, only the newest few`() {
        state.seeded = true
        serverHas(1, 2, 3, 4, 5, 6, 7, 8)

        engine(maxAlerts = 3).sync()

        assertEquals(8, store.rows.size)
        assertEquals(listOf("m6", "m7", "m8"), alerts.shown.map { it.key })
    }

    @Test
    fun `messages deleted on the dashboard disappear from the phone, and their notifications go too`() {
        state.seeded = true
        store.insert(listOf(m(1), m(2), m(3)))
        serverHas(3)

        engine().sync()

        assertEquals(setOf("m3"), store.rows.keys)
        assertEquals(setOf("m1", "m2"), alerts.cancelled.toSet())
    }

    @Test
    fun `a failed sync changes nothing and says why`() {
        state.seeded = true
        store.insert(listOf(m(1)))

        api.outcome = RecentOutcome.Failed("offline")
        assertEquals(SyncResult.Offline, engine().sync())
        api.outcome = RecentOutcome.Unauthorized
        assertEquals(SyncResult.Unauthorized, engine().sync())

        assertEquals(setOf("m1"), store.rows.keys)
        assertTrue(alerts.shown.isEmpty())
        assertTrue(alerts.cancelled.isEmpty())
    }

    // --- live events ---

    @Test
    fun `a new message is stored and shown at once`() {
        state.seeded = true

        engine().onEvent("message", json(m(4)))

        assertEquals(setOf("m4"), store.rows.keys)
        assertEquals(listOf("m4"), alerts.shown.map { it.key })
    }

    @Test
    fun `the same message arriving twice is shown once`() {
        state.seeded = true
        val e = engine()

        e.onEvent("message", json(m(4)))
        e.onEvent("message", json(m(4)))

        assertEquals(1, alerts.shown.size)
    }

    @Test
    fun `a message the user's rules hide is still kept in the list, just not alerted`() {
        state.seeded = true
        settings = ReceiverSettings(types = setOf("notification"))

        engine().onEvent("message", json(m(4, type = "sms")))

        assertEquals(setOf("m4"), store.rows.keys)
        assertTrue(alerts.shown.isEmpty())
    }

    @Test
    fun `clearing one phone's messages on the dashboard removes them here and cancels their notifications`() {
        store.insert(listOf(m(1, "d1"), m(2, "d2"), m(3, "d1")))

        engine().onEvent("messages_cleared", """{"deviceId":"d1"}""")

        assertEquals(setOf("m2"), store.rows.keys)
        assertEquals(setOf("m1", "m3"), alerts.cancelled.toSet())
    }

    @Test
    fun `clearing everything empties the list and every notification`() {
        store.insert(listOf(m(1), m(2)))

        engine().onEvent("messages_cleared_all", "{}")

        assertTrue(store.rows.isEmpty())
        assertEquals(1, alerts.cancelledAll)
    }

    @Test
    fun `an erased phone takes its messages with it`() {
        store.insert(listOf(m(1, "d1"), m(2, "d2")))

        engine().onEvent("device_deleted", """{"deviceId":"d1"}""")

        assertEquals(setOf("m2"), store.rows.keys)
    }

    @Test
    fun `when the retention limit deleted old messages, the phone looks again`() {
        state.seeded = true
        store.insert(listOf(m(1), m(2)))
        serverHas(2)

        engine().onEvent("messages_purged", "{}")

        assertEquals(setOf("m2"), store.rows.keys)
    }

    @Test
    fun `news it does not understand, or damaged news, is ignored without crashing`() {
        val e = engine()

        e.onEvent("something_new", "{}")
        e.onEvent("message", "not json")
        e.onEvent("messages_cleared", "{}")

        assertTrue(store.rows.isEmpty())
        assertFalse(alerts.shown.isNotEmpty())
    }

    // --- a sender phone going quiet, and coming back ---

    @Test
    fun `a phone going quiet shows a notice naming it`() {
        engine().onEvent("device_quiet", """{"deviceId":"d1","deviceName":"Kitchen phone","minutes":180}""")

        assertEquals(listOf("Kitchen phone has gone quiet"), alerts.statuses.map { it.title })
        assertTrue(alerts.shown.isEmpty())
    }

    @Test
    fun `a phone coming back replaces that notice`() {
        engine().onEvent("device_quiet", """{"deviceId":"d1","deviceName":"Kitchen phone","minutes":180}""")
        engine().onEvent("device_back", """{"deviceId":"d1","deviceName":"Kitchen phone"}""")

        assertEquals(listOf("Kitchen phone has gone quiet", "Kitchen phone is back"), alerts.statuses.map { it.title })
        assertEquals(alerts.statuses[0].key, alerts.statuses[1].key)
    }

    @Test
    fun `quiet-phone notices follow the switches`() {
        settings = ReceiverSettings(quietAlerts = false)
        engine().onEvent("device_quiet", """{"deviceId":"d1","deviceName":"Kitchen phone","minutes":180}""")
        settings = ReceiverSettings(enabled = false)
        engine().onEvent("device_quiet", """{"deviceId":"d1","deviceName":"Kitchen phone","minutes":180}""")

        assertTrue(alerts.statuses.isEmpty())
    }

    @Test
    fun `switching quiet-phone alerts off still clears a notice that is already showing when the phone returns`() {
        engine().onEvent("device_quiet", """{"deviceId":"d1","deviceName":"Kitchen phone","minutes":180}""")
        settings = ReceiverSettings(quietAlerts = false)
        engine().onEvent("device_back", """{"deviceId":"d1","deviceName":"Kitchen phone"}""")

        assertEquals(listOf(QuietPlanner.keyFor("d1")), alerts.cancelled)
        assertEquals(1, alerts.statuses.size) // only the first; no "is back" while switched off
    }

    @Test
    fun `an erased phone takes its quiet notice with it`() {
        engine().onEvent("device_deleted", """{"deviceId":"d1"}""")

        assertTrue(QuietPlanner.keyFor("d1") in alerts.cancelled)
    }

    @Test
    fun `damaged quiet news is ignored`() {
        engine().onEvent("device_quiet", "not json")
        engine().onEvent("device_quiet", """{"minutes":5}""")
        engine().onEvent("device_back", "{")

        assertTrue(alerts.statuses.isEmpty())
    }
}
