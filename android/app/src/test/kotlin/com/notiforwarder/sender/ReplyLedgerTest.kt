package com.notiforwarder.sender

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReplyLedgerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun name() = "ledger-${System.nanoTime()}"

    @Test
    fun `remembers what happened to a reply, across a restart`() {
        val file = name()
        PrefsReplyLedger(context, file).put("r1", LedgerEntry(LedgerState.FAILED, "no_permission", reported = false))

        val again = PrefsReplyLedger(context, file)

        assertEquals(LedgerEntry(LedgerState.FAILED, "no_permission", reported = false), again.get("r1"))
        assertNull(again.get("never-seen"))
    }

    @Test
    fun `updates an entry in place`() {
        val ledger = PrefsReplyLedger(context, name())
        ledger.put("r1", LedgerEntry(LedgerState.STARTED, null, reported = false))
        ledger.put("r1", LedgerEntry(LedgerState.SENT, null, reported = true))

        assertEquals(LedgerEntry(LedgerState.SENT, null, reported = true), ledger.get("r1"))
    }

    @Test
    fun `keeps only the newest entries so it cannot grow forever`() {
        val ledger = PrefsReplyLedger(context, name(), keep = 3)
        for (i in 1..5) ledger.put("r$i", LedgerEntry(LedgerState.SENT, null, reported = true))

        assertNull(ledger.get("r1"))
        assertNull(ledger.get("r2"))
        assertEquals(LedgerState.SENT, ledger.get("r5")?.state)
        assertEquals(LedgerState.SENT, ledger.get("r3")?.state)
    }
}
