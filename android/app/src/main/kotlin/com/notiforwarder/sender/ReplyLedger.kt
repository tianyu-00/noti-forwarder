package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit

enum class LedgerState {
    /** The text was about to go out. If the app died here, nobody knows whether it did. */
    STARTED,
    SENT,
    FAILED,
}

/** What this phone did with one reply, and whether the server has been told. */
data class LedgerEntry(val state: LedgerState, val error: String?, val reported: Boolean)

/**
 * The phone's own record of the replies it has handled, kept on the phone. It is what stops one
 * reply being sent twice (the server may list it again, or the app may restart mid-send).
 */
interface ReplyLedger {
    fun get(id: String): LedgerEntry?
    fun put(id: String, entry: LedgerEntry)
}

class PrefsReplyLedger(context: Context, name: String = "reply_ledger", private val keep: Int = 200) : ReplyLedger {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    // One line per reply, oldest first: "id|STATE|error|0 or 1". Ids are uuids and errors are
    // lower-case codes, so neither holds a "|".
    private fun read(): MutableList<Pair<String, LedgerEntry>> =
        prefs.getString(KEY, "").orEmpty().lines().filter { it.isNotBlank() }.mapNotNull { line ->
            val parts = line.split('|')
            val state = runCatching { LedgerState.valueOf(parts[1]) }.getOrNull()
            if (parts.size != 4 || state == null) null
            else parts[0] to LedgerEntry(state, parts[2].ifEmpty { null }, parts[3] == "1")
        }.toMutableList()

    @Synchronized
    override fun get(id: String) = read().firstOrNull { it.first == id }?.second

    @Synchronized
    override fun put(id: String, entry: LedgerEntry) {
        val entries = read()
        val at = entries.indexOfFirst { it.first == id }
        if (at >= 0) entries[at] = id to entry else entries += id to entry
        val kept = entries.takeLast(keep)
        prefs.edit {
            putString(KEY, kept.joinToString("\n") { (key, e) -> "$key|${e.state}|${e.error.orEmpty()}|${if (e.reported) 1 else 0}" })
        }
    }

    private companion object {
        const val KEY = "entries"
    }
}
