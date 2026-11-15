package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

// The phone keeps a copy of the newest messages. This works out how to bring it in line with the server's
// newest page: add what is new, and drop what was deleted on the dashboard.
class SyncPlannerTest {
    private fun m(id: String, at: String = "2026-11-11T10:00:0${id.last()}.000Z") =
        ReceivedMessage(id, "d1", "Kitchen", "sms", "sms", null, "BANK", "text $id", at, null)

    private fun ref(id: String, at: String = "2026-11-11T10:00:0${id.last()}.000Z") = LocalRef(id, at)

    @Test
    fun `nothing changes when both sides agree`() {
        val plan = SyncPlanner.plan(local = listOf(ref("m3"), ref("m2")), server = listOf(m("m3"), m("m2")), window = 10)

        assertEquals(emptyList<ReceivedMessage>(), plan.toAdd)
        assertEquals(emptyList<String>(), plan.toDelete)
    }

    @Test
    fun `new messages on the server are added`() {
        val plan = SyncPlanner.plan(local = listOf(ref("m1")), server = listOf(m("m3"), m("m2"), m("m1")), window = 10)

        assertEquals(listOf("m3", "m2"), plan.toAdd.map { it.id })
        assertEquals(emptyList<String>(), plan.toDelete)
    }

    @Test
    fun `messages deleted on the dashboard are removed when the server's list is complete`() {
        val plan = SyncPlanner.plan(local = listOf(ref("m3"), ref("m2"), ref("m1")), server = listOf(m("m3")), window = 10)

        assertEquals(listOf("m2", "m1"), plan.toDelete.sorted().reversed())
    }

    @Test
    fun `everything is removed when the dashboard has nothing left`() {
        val plan = SyncPlanner.plan(local = listOf(ref("m2"), ref("m1")), server = emptyList(), window = 10)

        assertEquals(setOf("m2", "m1"), plan.toDelete.toSet())
    }

    @Test
    fun `when the server's list is a full page, older messages beyond it are left alone`() {
        // The server sent its newest 2 (m5, m4). The phone also holds m1, which is older than the page: not deleted.
        val plan = SyncPlanner.plan(local = listOf(ref("m5"), ref("m4"), ref("m1")), server = listOf(m("m5"), m("m4")), window = 2)

        assertEquals(emptyList<String>(), plan.toDelete)
    }

    @Test
    fun `but a message inside the page's time range that the server no longer has is removed`() {
        // Page is m5 and m3 (newest 2). Local m4 sits between them in time, and is missing from the page: deleted.
        val plan = SyncPlanner.plan(local = listOf(ref("m5"), ref("m4"), ref("m3"), ref("m1")), server = listOf(m("m5"), m("m3")), window = 2)

        assertEquals(listOf("m4"), plan.toDelete)
    }
}
