package com.notiforwarder.sender

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** What the phone sent, what is still waiting, and what the server refused. Names and times only. */
data class ActivityView(val items: List<ActivityItem>, val summary: ActivitySummary)

@Composable
internal fun ActivityScreen(view: ActivityView?) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Activity")
        if (view == null) {
            Text("Loading…", color = colors.onSurfaceVariant, modifier = Modifier.padding(4.dp))
            return@Column
        }
        FlowRow(
            modifier = Modifier.padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chip("${view.summary.sentToday} sent today", good = true)
            if (view.summary.waiting > 0) WarnChip("${view.summary.waiting} waiting")
            if (view.summary.rejected > 0) Chip("${view.summary.rejected} rejected")
        }
        if (view.items.isEmpty()) {
            NotiCard {
                Text(
                    "Nothing has been forwarded yet. Texts and notifications will appear here as they are sent.",
                    color = colors.onSurfaceVariant,
                )
            }
        } else {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 2.dp)) {
                view.items.forEachIndexed { index, item ->
                    if (index > 0) RowDivider()
                    ActivityRowView(item)
                }
            }
        }
        Text(
            "Only the name and time are shown here. Message text stays out of this list.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.outline,
            modifier = Modifier.padding(horizontal = 6.dp),
        )
    }
}

@Composable
private fun ActivityRowView(item: ActivityItem) {
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier.size(40.dp).clip(CircleShape).background(colors.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                item.name.firstOrNull()?.uppercase() ?: "?",
                fontWeight = FontWeight.Bold,
                color = colors.onPrimaryContainer,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(item.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${item.kind} · ${item.whenText}",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
            )
        }
        when (item.state) {
            ActivityState.Sent -> Chip("Sent", good = true)
            ActivityState.Waiting -> WarnChip("Waiting")
            ActivityState.Rejected -> Chip("Rejected")
        }
    }
}
