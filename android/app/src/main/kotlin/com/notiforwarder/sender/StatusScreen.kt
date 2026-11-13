package com.notiforwarder.sender

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** What the phone needs from the user to keep forwarding, and how each item stands. */
data class Readiness(
    val accessGranted: Boolean,
    val notificationsAllowed: Boolean,
    val batteryExempt: Boolean,
    val smsAllowed: Boolean,
)

/** Is it working? The connection, what is waiting, and what still needs attention. */
@Composable
internal fun StatusScreen(
    paired: UiState.Paired,
    connection: ConnectionState,
    queue: QueueStatus?,
    now: Long,
    settings: CaptureSettings,
    ready: Readiness,
    onOpenAccessSettings: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onAllowNotifications: () -> Unit,
    onAllowSms: () -> Unit,
    onOpenAutoStart: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier.padding(start = 4.dp).size(28.dp).clip(RoundedCornerShape(9.dp)).background(colors.primary),
                contentAlignment = Alignment.Center,
            ) { Text("N", color = colors.onPrimary, fontWeight = FontWeight.Bold) }
            Text("Notiforwarder", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        val good = connection == ConnectionState.Connected
        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                val dot = if (good) colors.tertiary else colors.outline
                Box(Modifier.size(26.dp).clip(CircleShape).background(dot.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(14.dp).clip(CircleShape).background(dot))
                }
                Text(connectionHeadline(connection), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Text(
                "Sending to ${serverName(paired.serverUrl)}",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp),
            )
            FlowRow(
                modifier = Modifier.padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Chip(if (paired.encrypted) "End-to-end encrypted" else "Not end-to-end encrypted", good = paired.encrypted)
                Chip("Paired")
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("Waiting to send", queue?.queued?.toString() ?: "…", Modifier.weight(1f))
            StatTile("Last send", queue?.let { describeAgoShort(it.lastSuccessAt, now) } ?: "…", Modifier.weight(1f))
        }

        if (queue != null && queue.quarantined > 0) {
            NotiCard {
                Text(
                    "${queue.quarantined} rejected by the server and kept on this phone",
                    color = colors.error,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Keep it running")
            runningChecks(settings, ready).forEachIndexed { index, check ->
                if (index > 0) RowDivider()
                CheckRow(
                    text = check.text,
                    ok = check.ok,
                    detail = check.detail,
                    action = check.action,
                    onAction = when (check.kind) {
                        RunningCheck.Kind.NotificationAccess -> onOpenAccessSettings
                        RunningCheck.Kind.Battery -> onRequestBatteryExemption
                        RunningCheck.Kind.PostNotifications -> onAllowNotifications
                        RunningCheck.Kind.Sms -> onAllowSms
                        RunningCheck.Kind.AutoStart -> onOpenAutoStart
                    },
                )
            }
        }
    }
}
