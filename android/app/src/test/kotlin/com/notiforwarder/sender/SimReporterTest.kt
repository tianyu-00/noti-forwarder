package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class SimReporterTest {
    private class FakeSims(var outcome: ReportOutcome = ReportOutcome.Reported) : SimsApi {
        val puts = mutableListOf<List<ReportedSim>>()
        val replyStates = mutableListOf<ReportedReplies>()
        override fun put(sims: List<ReportedSim>, replies: ReportedReplies): ReportOutcome {
            puts += sims
            replyStates += replies
            return outcome
        }
    }

    private val api = FakeSims()
    private var installed: List<SimOption>? = listOf(SimOption(3, 1, "China Mobile"), SimOption(5, 2, "Giffgaff"))
    private var allowed = setOf(5)
    private var replies = ReportedReplies(on = true, permission = true, practice = false)
    private fun reporter() = SimReporter(api, installed = { installed }, allowed = { allowed }, replies = { replies })

    @Test
    fun `tells the server each SIM and whether the phone allows replies on it`() {
        reporter().report()

        assertEquals(
            listOf(listOf(ReportedSim(3, 1, "China Mobile", false), ReportedSim(5, 2, "Giffgaff", true))),
            api.puts,
        )
    }

    @Test
    fun `reports an empty list when the SIMs cannot be listed, so the dashboard can say why replies are off`() {
        installed = null

        reporter().report()

        assertEquals(listOf(emptyList<ReportedSim>()), api.puts)
    }

    @Test
    fun `does not repeat a list the server already has`() {
        val r = reporter()

        r.report()
        r.report()

        assertEquals(1, api.puts.size)
    }

    @Test
    fun `reports again when the allowed SIMs change`() {
        val r = reporter()
        r.report()

        allowed = setOf(3, 5)
        r.report()

        assertEquals(2, api.puts.size)
        assertEquals(listOf(true, true), api.puts.last().map { it.allowed })
    }

    @Test
    fun `force reports even when nothing changed, for a new connection`() {
        val r = reporter()
        r.report()

        r.report(force = true)

        assertEquals(2, api.puts.size)
    }

    @Test
    fun `tries again after a failure`() {
        val r = reporter()
        api.outcome = ReportOutcome.Failed("offline")
        r.report()

        api.outcome = ReportOutcome.Reported
        r.report()

        assertEquals(2, api.puts.size)
    }

    @Test
    fun `a phone with no SIM reports an empty list`() {
        installed = emptyList()

        reporter().report()

        assertEquals(listOf(emptyList<ReportedSim>()), api.puts)
    }

    @Test
    fun `tells the server whether replies are on, allowed and in practice`() {
        replies = ReportedReplies(on = false, permission = true, practice = true)

        reporter().report()

        assertEquals(listOf(ReportedReplies(on = false, permission = true, practice = true)), api.replyStates)
    }

    @Test
    fun `reports again when only the reply state changes`() {
        val r = reporter()
        r.report()

        replies = replies.copy(on = false)
        r.report()

        assertEquals(2, api.puts.size)
        assertEquals(false, api.replyStates.last().on)
    }
}
