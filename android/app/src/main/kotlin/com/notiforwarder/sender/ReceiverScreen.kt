package com.notiforwarder.sender

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What the receiver's screens need from the app. */
internal class ReceiverActions(
    val onUnpair: () -> Unit,
    val onAllowNotifications: () -> Unit,
    val onRequestBatteryExemption: () -> Unit,
    val onThemeChange: (ThemeMode) -> Unit,
    val onCheckUpdate: () -> Unit,
    val onInstallUpdate: () -> Unit,
    val onAllowInstall: () -> Unit,
)

/** The receiver's pages, picked from the bottom bar: Status, Alerts and Settings. */
@Composable
internal fun ReceiverScreen(
    app: NotiApp,
    paired: UiState.Paired,
    ready: Readiness,
    themeMode: ThemeMode,
    updateState: UpdateState,
    tab: Tab,
    actions: ReceiverActions,
) {
    // The list is read from the phone's own copy; the connection keeps that copy in step with the dashboard.
    var messages by remember { mutableStateOf<List<ReceivedMessage>>(emptyList()) }
    LaunchedEffect(Unit) {
        while (true) {
            messages = withContext(Dispatchers.IO) { app.receivedStore.recent(300) }
            delay(2_000)
        }
    }
    val connection by app.receiverStream.state.collectAsState()

    // The alert rules are a page behind Settings; the back button and leaving the tab both close it.
    var showAlertSettings by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(tab) { if (tab != Tab.Settings) showAlertSettings = false }
    BackHandler(enabled = showAlertSettings && tab == Tab.Settings) { showAlertSettings = false }

    when (tab) {
        Tab.Alerts -> AlertsScreen(app, messages)
        Tab.Settings ->
            if (showAlertSettings) {
                ReceiverAlertSettingsScreen(app, messages, onBack = { showAlertSettings = false })
            } else {
                ReceiverSettingsScreen(app, paired, themeMode, updateState, actions, onOpenAlertSettings = { showAlertSettings = true })
            }
        else -> {
            // Worked out again each time the list is re-read (every couple of seconds).
            val stats = remember(messages) {
                val startOfToday = java.time.LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
                receiverStats(messages, startOfToday)
            }
            ReceiverStatusScreen(paired, connection, ready, stats, actions)
        }
    }
}

@Composable
private fun ReceiverStatusScreen(
    paired: UiState.Paired,
    connection: ConnectionState,
    ready: Readiness,
    stats: ReceiverStats,
    actions: ReceiverActions,
) {
    val colors = MaterialTheme.colorScheme
    val now = System.currentTimeMillis()
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier.padding(start = 4.dp).size(28.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(9.dp)).background(colors.primary),
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
                "Receiving from ${serverName(paired.serverUrl)}",
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp),
            )
            androidx.compose.foundation.layout.FlowRow(
                modifier = Modifier.padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Chip(if (paired.encrypted) "End-to-end encrypted" else "Not end-to-end encrypted", good = paired.encrypted)
                Chip("Receiver")
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("Today", stats.today.toString(), Modifier.weight(1f))
            StatTile("Last message", describeAgoShort(stats.lastAt, now), Modifier.weight(1f))
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Keep it running")
            CheckRow(
                text = if (ready.notificationsAllowed) "Notifications are allowed" else "Allow notifications",
                ok = ready.notificationsAllowed,
                detail = if (ready.notificationsAllowed) null else "Without it, alerts cannot show on this phone",
                action = if (ready.notificationsAllowed) null else "Allow",
                onAction = actions.onAllowNotifications,
            )
            RowDivider()
            CheckRow(
                text = if (ready.batteryExempt) "Battery optimisation is off" else "Battery optimisation is on",
                ok = ready.batteryExempt,
                detail = if (ready.batteryExempt) null else "Alerts may arrive late, or not at all, when the screen is off",
                action = if (ready.batteryExempt) null else "Turn off",
                onAction = actions.onRequestBatteryExemption,
            )
        }
    }
}

@Composable
private fun AlertsScreen(app: NotiApp, messages: List<ReceivedMessage>) {
    val colors = MaterialTheme.colorScheme
    val reader = remember { MessageReader { app.store.load()?.e2eKey } }
    val clipboard = LocalClipboardManager.current
    val now = System.currentTimeMillis()

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Box(Modifier.padding(top = 20.dp)) { ScreenTitle("Alerts") } }
        if (messages.isEmpty()) {
            item {
                Text(
                    "No messages yet. They appear here as your sender phones receive them.",
                    color = colors.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }
        }
        items(messages, key = { it.id }) { message ->
            val d = MessageDescriber.describe(message, reader.read(message))
            val at = runCatching { java.time.Instant.parse(message.receivedAt).toEpochMilli() }.getOrNull()
            var expanded by rememberSaveable(message.id) { mutableStateOf(false) }
            val text = d.text.trim().replace(Regex("\\s*\\n\\s*\\n(\\s*\\n)*"), "\n\n")
            // Set by the text itself when six lines are not enough; stays true once expanded so the button can fold it again.
            var cutOff by remember(message.id) { mutableStateOf(false) }
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
                Text(d.title, fontWeight = FontWeight.SemiBold)
                Text(
                    text,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = if (expanded) Int.MAX_VALUE else 6,
                    overflow = TextOverflow.Clip,
                    onTextLayout = { if (!expanded) cutOff = it.hasVisualOverflow },
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    listOfNotNull(d.device, describeAgo(at, now)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
                val showMore = cutOff || expanded
                if (showMore || d.code != null) {
                    // One row of actions: Copy code on the left, Show more on the right.
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        d.code?.let { code ->
                            // The button says so for two seconds, so a tap is never silent.
                            var copied by remember(message.id) { mutableStateOf(false) }
                            LaunchedEffect(copied) {
                                if (copied) {
                                    delay(2_000)
                                    copied = false
                                }
                            }
                            TextButton(onClick = { clipboard.setText(AnnotatedString(code)); copied = true }) {
                                if (copied) {
                                    IconMark(AppIcon.Check, MaterialTheme.colorScheme.primary, Modifier.padding(end = 6.dp))
                                    Text("Copied")
                                } else {
                                    Text("Copy code")
                                }
                            }
                        }
                        Box(Modifier.weight(1f))
                        if (showMore) {
                            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Show less" else "Show more") }
                        }
                    }
                }
            }
        }
        item { Box(Modifier.padding(bottom = 20.dp)) }
    }
}

@Composable
private fun ReceiverSettingsScreen(
    app: NotiApp,
    paired: UiState.Paired,
    themeMode: ThemeMode,
    updateState: UpdateState,
    actions: ReceiverActions,
    onOpenAlertSettings: () -> Unit,
) {
    val alertsOn = remember { app.receiverSettingsStore.load().enabled }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Settings")

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Connection")
            KeyValueRow("Server", serverName(paired.serverUrl))
            RowDivider()
            KeyValueRow("Encryption", if (paired.encrypted) "On" else "Off")
            RowDivider()
            SecondaryButton(onClick = actions.onUnpair, danger = true, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { Text("Unpair this phone") }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Appearance")
            Column(modifier = Modifier.padding(bottom = 10.dp)) {
                Choice(
                    options = listOf(ThemeMode.SYSTEM to "System", ThemeMode.LIGHT to "Light", ThemeMode.DARK to "Dark"),
                    selected = themeMode,
                    onSelect = actions.onThemeChange,
                )
            }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            KeyValueRow("Alert settings", if (alertsOn) "On" else "Off", onClick = onOpenAlertSettings, chevron = true)
        }

        UpdateCard(updateState, actions.onCheckUpdate, actions.onInstallUpdate, actions.onAllowInstall)
    }
}

/** The receiver's alert rules, on a page of their own behind Settings. */
@Composable
private fun ReceiverAlertSettingsScreen(app: NotiApp, messages: List<ReceivedMessage>, onBack: () -> Unit) {
    var settings by remember { mutableStateOf(app.receiverSettingsStore.load()) }
    val change = { updated: ReceiverSettings ->
        settings = updated
        app.receiverSettingsStore.save(updated)
    }
    val apps = remember(messages) { appsSeen(messages) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        TextButton(onClick = onBack) {
            IconMark(AppIcon.ChevronLeft, MaterialTheme.colorScheme.primary, Modifier.padding(end = 4.dp), size = 18.dp)
            Text("Settings")
        }
        ScreenTitle("Alert settings")

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 10.dp)) {
            CardLabel("Alerts")
            SwitchRow("Show alerts", "Turn off to stop notifications without unpairing", settings.enabled) { change(settings.copy(enabled = it)) }
            RowDivider()
            Column(modifier = Modifier.padding(vertical = 10.dp)) {
                Text("Which messages", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Choice(
                    options = listOf(AlertMode.All to "All messages", AlertMode.CodesOnly to "2FA codes only"),
                    selected = settings.mode,
                    onSelect = { change(settings.copy(mode = it)) },
                )
            }
            RowDivider()
            SwitchRow("Text messages", "Alerts for each SMS", "sms" in settings.types) { on ->
                change(settings.copy(types = if (on) settings.types + "sms" else settings.types - "sms"))
            }
            RowDivider()
            SwitchRow("App notifications", "Alerts for what apps on your sender phones show", "notification" in settings.types) { on ->
                change(settings.copy(types = if (on) settings.types + "notification" else settings.types - "notification"))
            }
            RowDivider()
            SwitchRow("Quiet phones", "Tell me when a sender phone stops checking in, and when it is back", settings.quietAlerts) {
                change(settings.copy(quietAlerts = it))
            }
        }

        if (apps.isNotEmpty()) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 10.dp)) {
                CardLabel("Apps")
                Text(
                    "Turn off an app to stop its alerts. The list comes from notifications you have received.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
                apps.forEachIndexed { index, seen ->
                    if (index > 0) RowDivider()
                    SwitchRow(seen.name, seen.packageName, seen.packageName !in settings.blockedApps) { on ->
                        change(settings.copy(blockedApps = if (on) settings.blockedApps - seen.packageName else settings.blockedApps + seen.packageName))
                    }
                }
            }
        }
    }
}
