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
    var onSend: () -> Unit = {}

    override fun send(to: String, text: String): SmsResult {
        onSend()
        texts += to to text
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
    private var settings = CaptureSettings(allowReplies = true)
    private var permitted = true
    private var credentials: Credentials? = Credentials("https://x", "dev-1", "t", e2eKey = null)

    private fun processor() = ReplyProcessor(
        outbox = outbox,
        sms = sms,
        ledger = ledger,
        settings = { settings },
        canSendSms = { permitted },
        e2eKey = { credentials?.e2eKey },
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
}
