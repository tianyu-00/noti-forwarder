package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class ActivityItemsTest {
    private val now = 10_000_000_000L
    private val minute = 60_000L

    private fun row(
        type: String = "notification",
        app: String = "com.google.android.gm",
        sender: String = "Tian",
        at: Long = now - 5 * minute,
        state: ActivityState = ActivityState.Sent,
    ) = ActivityRow("id-$type-$app-$sender", type, app, sender, at, state)

    private fun items(vararg rows: ActivityRow, label: (String) -> String? = { null }) =
        toActivityItems(rows.toList(), label, now)

    @Test
    fun `a text message is named after who sent it`() {
        val item = items(row(type = "sms", app = "sms", sender = "NORTHWIND")).single()

        assertEquals("NORTHWIND", item.name)
        assertEquals("SMS", item.kind)
    }

    @Test
    fun `a text message with no sender is called unknown`() {
        assertEquals("Unknown sender", items(row(type = "sms", app = "sms", sender = "")).single().name)
    }

    @Test
    fun `an app notification is named after the app, as the phone shows it`() {
        val item = items(row(), label = { if (it == "com.google.android.gm") "Gmail" else null }).single()

        assertEquals("Gmail", item.name)
        assertEquals("App", item.kind)
    }

    @Test
    fun `an app the phone cannot name keeps its package name`() {
        assertEquals("com.gone.app", items(row(app = "com.gone.app")).single().name)
    }

    @Test
    fun `says how long ago, briefly`() {
        assertEquals("5 min ago", items(row(at = now - 5 * minute)).single().whenText)
    }

    @Test
    fun `keeps the order and the state`() {
        val list = items(
            row(sender = "a", state = ActivityState.Waiting),
            row(sender = "b", state = ActivityState.Rejected),
        )

        assertEquals(listOf(ActivityState.Waiting, ActivityState.Rejected), list.map { it.state })
    }
}

class ActivitySummaryTest {
    private val startOfToday = 5_000L

    private fun row(at: Long, state: ActivityState) =
        ActivityRow("id-$at-$state", "sms", "sms", "X", at, state)

    @Test
    fun `counts what was sent today, what is waiting and what was refused`() {
        val summary = summarise(
            listOf(
                row(6_000, ActivityState.Sent),
                row(7_000, ActivityState.Sent),
                row(4_000, ActivityState.Sent), // yesterday
                row(8_000, ActivityState.Waiting),
                row(9_000, ActivityState.Rejected),
            ),
            startOfToday,
        )

        assertEquals(ActivitySummary(sentToday = 2, waiting = 1, rejected = 1), summary)
    }

    @Test
    fun `is all zero when there is nothing`() {
        assertEquals(ActivitySummary(0, 0, 0), summarise(emptyList(), startOfToday))
    }
}
