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
    /** The SIMs in the phone, or null when the app is not allowed to look (no phone permission). */
    private val sims: () -> List<SimOption>? = { null },
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
        val current = settings()
        // Practice mode needs neither the switch nor the permission: it never sends, so it can run
        // anywhere, and being on it overrides everything below.
        if (!current.practiceReplies) {
            if (!current.allowReplies) return finish(reply.id, LedgerState.FAILED, "replies_off")
            if (!canSendSms()) return finish(reply.id, LedgerState.FAILED, "no_permission")
        }
        val plain = when (val opened = open(reply)) {
            is Opened.Text -> opened
            is Opened.Refused -> return finish(reply.id, LedgerState.FAILED, opened.code)
        }
        if (!PHONE_NUMBER.matches(plain.to)) return finish(reply.id, LedgerState.FAILED, "bad_number")
        if (plain.body.isBlank()) return finish(reply.id, LedgerState.FAILED, "bad_message")
        // Opened and checked as for real; this is the point where a real send would happen.
        if (current.practiceReplies) return finish(reply.id, LedgerState.FAILED, "practice")

        val sim = when (val chosen = chooseSim(current)) {
            is SimChoice.Use -> chosen.subscriptionId
            is SimChoice.Refuse -> return finish(reply.id, LedgerState.FAILED, chosen.code)
        }

        ledger.put(reply.id, LedgerEntry(LedgerState.STARTED, error = null, reported = false))
        val result = try {
            sms.send(plain.to, plain.body, sim)
        } catch (e: Exception) {
            SmsResult.Failed("generic")
        }
        when (result) {
            SmsResult.Sent -> finish(reply.id, LedgerState.SENT, null)
            is SmsResult.Failed -> finish(reply.id, LedgerState.FAILED, result.code)
        }
    }

    private sealed interface SimChoice {
        data class Use(val subscriptionId: Int?) : SimChoice
        data class Refuse(val code: String) : SimChoice
    }

    // Which SIM sends. The SIMs must be checkable, a chosen SIM that is gone is never swapped for
    // another, and with two SIMs and no choice the phone will not guess, because one may be roaming.
    private fun chooseSim(current: CaptureSettings): SimChoice {
        val installed = sims()
        val chosen = current.replySim
        return when {
            // Without phone access the app cannot tell how many SIMs there are, so it cannot know
            // that the default is safe to use.
            installed == null -> SimChoice.Refuse("sim_unknown")
            chosen != null ->
                if (installed.none { it.id == chosen }) SimChoice.Refuse("sim_missing") else SimChoice.Use(chosen)
            installed.size > 1 -> SimChoice.Refuse("choose_sim")
            else -> SimChoice.Use(null)
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
