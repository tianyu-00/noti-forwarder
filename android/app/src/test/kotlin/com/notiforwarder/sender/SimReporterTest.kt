package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class SimReporterTest {
    private class FakeSims(var outcome: ReportOutcome = ReportOutcome.Reported) : SimsApi {
        val puts = mutableListOf<List<ReportedSim>>()
        override fun put(sims: List<ReportedSim>): ReportOutcome {
            puts += sims
            return outcome
        }
    }

    private val api = FakeSims()
    private var installed: List<SimOption>? = listOf(SimOption(3, 1, "China Mobile"), SimOption(5, 2, "Giffgaff"))
    private var allowed = setOf(5)
    private fun reporter() = SimReporter(api, installed = { installed }, allowed = { allowed })

    @Test
    fun `tells the server each SIM and whether the phone allows replies on it`() {
        reporter().report()

        assertEquals(
            listOf(listOf(ReportedSim(3, 1, "China Mobile", false), ReportedSim(5, 2, "Giffgaff", true))),
            api.puts,
        )
    }

    @Test
    fun `says nothing when the SIMs cannot be listed, so the dashboard does not show a wrong list`() {
        installed = null

        reporter().report()

        assertEquals(emptyList<List<ReportedSim>>(), api.puts)
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
}
