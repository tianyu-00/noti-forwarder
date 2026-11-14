package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Fakes for the three things a reply touches: the server, the SMS radio and the saved record. */
private class FakeOutbox(var replies: List<OutboxReply> = emptyList()) : OutboxApi {
    val reports = mutableListOf<Triple<String, Boolean, String?>>()
    var pendingOutcome: PendingOutcome? = null
    var reportOutcome: ReportOutcome = ReportOutcome.Reported

    override fun pending() = pendingOutcome ?: PendingOutcome.Replies(replies)

    override fun report(id: String, sent: Boolean, error: String?): ReportOutcome {
        if (reportOutcome == ReportOutcome.Reported) reports += Triple(id, sent, error)
        return reportOutcome
    }
}

private class FakeSms(var result: SmsResult = SmsResult.Sent) : SmsSender {
    val texts = mutableListOf<Pair<String, String>>()
    val sims = mutableListOf<Int?>()
    var onSend: () -> Unit = {}

    override fun send(to: String, text: String, subscriptionId: Int?): SmsResult {
        onSend()
        texts += to to text
        sims += subscriptionId
        return result
    }
}

private class MemoryLedger : ReplyLedger {
    val entries = mutableMapOf<String, LedgerEntry>()
    override fun get(id: String) = entries[id]
    override fun put(id: String, entry: LedgerEntry) {
        entries[id] = entry
    }
}

class ReplyProcessorTest {
    private val key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    private val outbox = FakeOutbox()
    private val sms = FakeSms()
    private val ledger = MemoryLedger()
    private var settings = CaptureSettings(allowReplies = true, allowedSims = setOf(3))
    private var permitted = true
    private var credentials: Credentials? = Credentials("https://x", "dev-1", "t", e2eKey = null)
    // The SIMs in the phone, or null when the app is not allowed to look.
    private var sims: List<SimOption>? = listOf(SimOption(3, 1, "China Mobile"))

    private fun processor() = ReplyProcessor(
        outbox = outbox,
        sms = sms,
        ledger = ledger,
        settings = { settings },
        canSendSms = { permitted },
        e2eKey = { credentials?.e2eKey },
        sims = { sims },
    )

    private val reply = OutboxReply("r1", "+15551234567", "On my way")

    @Test
    fun `sends a waiting reply as a text to its number and tells the server it was sent`() {
        outbox.replies = listOf(reply)

        processor().process()

        assertEquals(listOf("+15551234567" to "On my way"), sms.texts)
        assertEquals(listOf(Triple("r1", true, null)), outbox.reports)
    }

    @Test
    fun `sends several in the order the server gave them`() {
        outbox.replies = listOf(reply, OutboxReply("r2", "+15559990000", "second"))

        processor().process()

        assertEquals(listOf("On my way", "second"), sms.texts.map { it.second })
        assertEquals(listOf("r1", "r2"), outbox.reports.map { it.first })
    }

    @Test
    fun `with replies switched off nothing is sent and the dashboard is told why`() {
        settings = CaptureSettings(allowReplies = false)
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "replies_off")), outbox.reports)
    }

    @Test
    fun `without the SMS permission nothing is sent and the dashboard is told why`() {
        permitted = false
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "no_permission")), outbox.reports)
    }

    @Test
    fun `a text the phone could not send is reported failed with the reason`() {
        sms.result = SmsResult.Failed("no_service")
        outbox.replies = listOf(reply)

        processor().process()

        assertEquals(listOf(Triple("r1", false, "no_service")), outbox.reports)
    }

    @Test
    fun `one failure does not stop the next reply`() {
        outbox.replies = listOf(reply, OutboxReply("r2", "+15559990000", "second"))
        var calls = 0
        sms.onSend = { if (calls++ == 0) sms.result = SmsResult.Failed("generic") else sms.result = SmsResult.Sent }

        processor().process()

        assertEquals(listOf(Triple("r1", false, "generic"), Triple("r2", true, null)), outbox.reports)
    }

    @Test
    fun `never sends the same reply twice, however often the server lists it`() {
        outbox.replies = listOf(reply)
        val p = processor()

        p.process()
        p.process()
        p.process()

        assertEquals(1, sms.texts.size)
        assertEquals(1, outbox.reports.size)
    }

    @Test
    fun `when telling the server fails, the next round tells it again without sending again`() {
        outbox.replies = listOf(reply)
        outbox.reportOutcome = ReportOutcome.Failed("offline")
        val p = processor()
        p.process()
        assertEquals(1, sms.texts.size)

        outbox.reportOutcome = ReportOutcome.Reported
        p.process()

        assertEquals(1, sms.texts.size)
        assertEquals(listOf(Triple("r1", true, null)), outbox.reports)
    }

    @Test
    fun `a failure that could not be reported is reported again later with the same reason`() {
        permitted = false
        outbox.replies = listOf(reply)
        outbox.reportOutcome = ReportOutcome.Failed("offline")
        val p = processor()
        p.process()
        outbox.reportOutcome = ReportOutcome.Reported
        permitted = true // the user fixed it, but this reply already failed: it is not retried

        p.process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "no_permission")), outbox.reports)
    }

    @Test
    fun `a reply that was being sent when the app died is not sent again, it is reported as interrupted`() {
        ledger.put("r1", LedgerEntry(LedgerState.STARTED, error = null, reported = false))
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "interrupted")), outbox.reports)
    }

    @Test
    fun `is recorded as started before the text goes out, so a crash cannot cause a second send`() {
        outbox.replies = listOf(reply)
        var seenWhileSending: LedgerState? = null
        sms.onSend = { seenWhileSending = ledger.get("r1")?.state }

        processor().process()

        assertEquals(LedgerState.STARTED, seenWhileSending)
    }

    @Test
    fun `refuses a number that is not a phone number`() {
        outbox.replies = listOf(OutboxReply("r1", "call me maybe", "hi"))

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "bad_number")), outbox.reports)
    }

    @Test
    fun `decrypts an encrypted reply with the pairing key and sends the plain text`() {
        credentials = credentials?.copy(e2eKey = key)
        outbox.replies = listOf(
            OutboxReply(
                "r1",
                "e2e:v1:eRE2mGyk26zCvJ9DQDOdL9sPPYIvagaIBZLDakFS8dqePXfeDqejsw",
                "e2e:v1:NZoxaKYmRRH5ShFxwuztOqsIncHN-Ou3_Hh9zsOv9TPQkn6bWoARZA",
            ),
        )

        processor().process()

        assertEquals(listOf("+15551234567" to "On my way é"), sms.texts)
        assertEquals(listOf(Triple("r1", true, null)), outbox.reports)
    }

    @Test
    fun `an encrypted reply on a phone without the key is reported, not sent as scrambled text`() {
        outbox.replies = listOf(
            OutboxReply(
                "r1",
                "e2e:v1:eRE2mGyk26zCvJ9DQDOdL9sPPYIvagaIBZLDakFS8dqePXfeDqejsw",
                "e2e:v1:NZoxaKYmRRH5ShFxwuztOqsIncHN-Ou3_Hh9zsOv9TPQkn6bWoARZA",
            ),
        )

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "no_key")), outbox.reports)
    }

    @Test
    fun `an encrypted reply that will not decrypt is reported, not sent`() {
        credentials = credentials?.copy(e2eKey = "BBECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
        outbox.replies = listOf(
            OutboxReply(
                "r1",
                "e2e:v1:eRE2mGyk26zCvJ9DQDOdL9sPPYIvagaIBZLDakFS8dqePXfeDqejsw",
                "e2e:v1:NZoxaKYmRRH5ShFxwuztOqsIncHN-Ou3_Hh9zsOv9TPQkn6bWoARZA",
            ),
        )

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "bad_message")), outbox.reports)
    }

    @Test
    fun `does nothing when the server cannot be reached or the phone is unpaired`() {
        for (outcome in listOf(PendingOutcome.NotPaired, PendingOutcome.Unauthorized, PendingOutcome.Failed("x"))) {
            outbox.pendingOutcome = outcome

            processor().process()
        }

        assertTrue(sms.texts.isEmpty())
        assertTrue(outbox.reports.isEmpty())
    }

    // --- Practice mode: everything except the text going out ---

    private val sealedTo = "e2e:v1:eRE2mGyk26zCvJ9DQDOdL9sPPYIvagaIBZLDakFS8dqePXfeDqejsw"
    private val sealedBody = "e2e:v1:NZoxaKYmRRH5ShFxwuztOqsIncHN-Ou3_Hh9zsOv9TPQkn6bWoARZA"

    @Test
    fun `in practice mode nothing is ever sent, and the dashboard is told it was only practice`() {
        settings = CaptureSettings(allowReplies = true, practiceReplies = true)
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "practice")), outbox.reports)
    }

    @Test
    fun `practice mode wins over everything, even replies being off, a missing permission or a chosen SIM`() {
        settings = CaptureSettings(allowReplies = false, practiceReplies = true, allowedSims = setOf(3))
        permitted = false
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "practice")), outbox.reports)
    }

    @Test
    fun `practice mode still opens and checks the reply, so it proves the real path`() {
        settings = CaptureSettings(practiceReplies = true)
        credentials = credentials?.copy(e2eKey = key)
        outbox.replies = listOf(
            OutboxReply("good", sealedTo, sealedBody),
            OutboxReply("number", "call me maybe", "hi"),
            OutboxReply("scrambled", sealedTo, "e2e:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        )

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(
            listOf(Triple("good", false, "practice"), Triple("number", false, "bad_number"), Triple("scrambled", false, "bad_message")),
            outbox.reports,
        )
    }

    @Test
    fun `an encrypted reply in practice mode on a phone without the key says so`() {
        settings = CaptureSettings(practiceReplies = true)
        outbox.replies = listOf(OutboxReply("r1", sealedTo, sealedBody))

        processor().process()

        assertEquals(listOf(Triple("r1", false, "no_key")), outbox.reports)
    }

    // --- Which SIM sends the text: the dashboard chooses, the phone only allows ---

    private val china = SimOption(3, 1, "China Mobile")
    private val giffgaff = SimOption(5, 2, "Giffgaff")

    @Test
    fun `sends from the SIM the dashboard chose, when the phone allows it`() {
        sims = listOf(china, giffgaff)
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(3, 5))
        outbox.replies = listOf(reply.copy(sim = 5))

        processor().process()

        assertEquals(listOf<Int?>(5), sms.sims)
        assertEquals(listOf(Triple("r1", true, null)), outbox.reports)
    }

    @Test
    fun `a SIM the phone does not allow is refused, even when the dashboard chose it`() {
        sims = listOf(china, giffgaff)
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(5))
        outbox.replies = listOf(reply.copy(sim = 3))

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "sim_not_allowed")), outbox.reports)
    }

    @Test
    fun `a chosen SIM that is no longer in the phone is never swapped for another, the reply fails`() {
        sims = listOf(china)
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(3, 5))
        outbox.replies = listOf(reply.copy(sim = 5))

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "sim_missing")), outbox.reports)
    }

    @Test
    fun `a chosen SIM that cannot be checked fails, because guessing could send on the wrong SIM`() {
        sims = null
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(5))
        outbox.replies = listOf(reply.copy(sim = 5))

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "sim_unknown")), outbox.reports)
    }

    @Test
    fun `a reply that names no SIM uses the one allowed SIM`() {
        sims = listOf(china, giffgaff)
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(5))
        outbox.replies = listOf(reply)

        processor().process()

        assertEquals(listOf<Int?>(5), sms.sims)
    }

    @Test
    fun `a reply that names no SIM is not sent when two SIMs are allowed, the phone will not pick one`() {
        sims = listOf(china, giffgaff)
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(3, 5))
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "choose_sim")), outbox.reports)
    }

    @Test
    fun `nothing is sent until the user has allowed a SIM, even on a phone with one SIM`() {
        sims = listOf(china)
        settings = CaptureSettings(allowReplies = true, allowedSims = emptySet())
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "sim_not_allowed")), outbox.reports)
    }

    @Test
    fun `when the SIMs cannot be listed and none was named nothing is sent, because it could be the wrong SIM`() {
        sims = null
        settings = CaptureSettings(allowReplies = true, allowedSims = setOf(3))
        outbox.replies = listOf(reply)

        processor().process()

        assertTrue(sms.texts.isEmpty())
        assertEquals(listOf(Triple("r1", false, "sim_unknown")), outbox.reports)
    }
}
