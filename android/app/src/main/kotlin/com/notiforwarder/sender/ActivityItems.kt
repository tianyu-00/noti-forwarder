package com.notiforwarder.sender

/** A line of the Activity tab, ready to show. */
data class ActivityItem(
    val id: String,
    val name: String,
    /** "SMS" or "App". */
    val kind: String,
    val whenText: String,
    val state: ActivityState,
)

/**
 * A text is named after who sent it. A notification is named after its app as the phone shows it
 * ("Gmail"), or by package name when the app is gone. No message text is ever part of this.
 */
fun toActivityItems(rows: List<ActivityRow>, labelFor: (String) -> String?, now: Long): List<ActivityItem> =
    rows.map { row ->
        val sms = row.type == "sms"
        ActivityItem(
            id = row.id,
            name = if (sms) row.sender.ifBlank { "Unknown sender" } else labelFor(row.app) ?: row.app,
            kind = if (sms) "SMS" else "App",
            whenText = describeAgoShort(row.at, now),
            state = row.state,
        )
    }

data class ActivitySummary(val sentToday: Int, val waiting: Int, val rejected: Int)

/** The counts above the list. [startOfToday] is local midnight, in milliseconds. */
fun summarise(rows: List<ActivityRow>, startOfToday: Long) = ActivitySummary(
    sentToday = rows.count { it.state == ActivityState.Sent && it.at >= startOfToday },
    waiting = rows.count { it.state == ActivityState.Waiting },
    rejected = rows.count { it.state == ActivityState.Rejected },
)
