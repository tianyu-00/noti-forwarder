package com.notiforwarder.sender

/**
 * Sends the replies typed on the dashboard. Asks the server what is waiting, sends each as an SMS
 * and reports the result. Safe to call as often as you like, from any thread: only one run goes at
 * a time, and a reply is never sent twice (see [ReplyLedger]).
 */
class ReplyProcessor(
    private val outbox: OutboxApi,
    private val sms: SmsSender,
    private val ledger: ReplyLedger,
    private val settings: () -> CaptureSettings,
    private val canSendSms: () -> Boolean,
    /** The end-to-end key from pairing, or null when this phone was paired without one. */
    private val e2eKey: () -> String?,
) {
    @Synchronized
    fun process() {
        val replies = (outbox.pending() as? PendingOutcome.Replies)?.replies ?: return
        for (reply in replies) handle(reply)
    }

    private fun handle(reply: OutboxReply) {
        val known = ledger.get(reply.id)
        when {
            known == null -> attempt(reply)
            // The app died while this one was going out: it may or may not have been sent, so it is
            // not sent again. The dashboard is told it is unknown.
            known.state == LedgerState.STARTED -> finish(reply.id, LedgerState.FAILED, "interrupted")
            !known.reported -> tell(reply.id, known)
            else -> Unit // done; nothing more to do
        }
    }

    private fun attempt(reply: OutboxReply) {
        if (!settings().allowReplies) return finish(reply.id, LedgerState.FAILED, "replies_off")
        if (!canSendSms()) return finish(reply.id, LedgerState.FAILED, "no_permission")
        val plain = when (val opened = open(reply)) {
            is Opened.Text -> opened
            is Opened.Refused -> return finish(reply.id, LedgerState.FAILED, opened.code)
        }
        if (!PHONE_NUMBER.matches(plain.to)) return finish(reply.id, LedgerState.FAILED, "bad_number")
        if (plain.body.isBlank()) return finish(reply.id, LedgerState.FAILED, "bad_message")

        ledger.put(reply.id, LedgerEntry(LedgerState.STARTED, error = null, reported = false))
        val result = try {
            sms.send(plain.to, plain.body)
        } catch (e: Exception) {
            SmsResult.Failed("generic")
        }
        when (result) {
            SmsResult.Sent -> finish(reply.id, LedgerState.SENT, null)
            is SmsResult.Failed -> finish(reply.id, LedgerState.FAILED, result.code)
        }
    }

    private sealed interface Opened {
        data class Text(val to: String, val body: String) : Opened
        data class Refused(val code: String) : Opened
    }

    // The dashboard encrypts a reply when its conversation is encrypted. Only this phone and that
    // browser hold the key; text that cannot be read is reported, never sent as scrambled bytes.
    private fun open(reply: OutboxReply): Opened {
        val sealed = reply.to.startsWith(E2eCipher.PREFIX) || reply.body.startsWith(E2eCipher.PREFIX)
        if (!sealed) return Opened.Text(reply.to, reply.body)
        val key = e2eKey() ?: return Opened.Refused("no_key")
        return try {
            val cipher = E2eCipher(key)
            fun field(name: String, value: String) =
                if (value.startsWith(E2eCipher.PREFIX)) cipher.decrypt(name, value) else value
            Opened.Text(field("reply-to", reply.to), field("reply-body", reply.body))
        } catch (e: Exception) {
            Opened.Refused("bad_message")
        }
    }

    private fun finish(id: String, state: LedgerState, error: String?) {
        val entry = LedgerEntry(state, error, reported = false)
        ledger.put(id, entry)
        tell(id, entry)
    }

    private fun tell(id: String, entry: LedgerEntry) {
        val outcome = outbox.report(id, sent = entry.state == LedgerState.SENT, error = entry.error)
        if (outcome == ReportOutcome.Reported) ledger.put(id, entry.copy(reported = true))
    }

    private companion object {
        val PHONE_NUMBER = Regex("""\+?[0-9][0-9 ()\-.]{2,31}""")
    }
}
