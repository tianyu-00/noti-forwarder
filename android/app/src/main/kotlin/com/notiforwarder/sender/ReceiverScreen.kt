package com.notiforwarder.sender

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
    val onChangeRole: () -> Unit,
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

    when (tab) {
        Tab.Alerts -> AlertsScreen(app, messages)
        Tab.Settings -> ReceiverSettingsScreen(app, paired, ready, themeMode, updateState, actions, messages)
        else -> ReceiverStatusScreen(connection, ready, messages.size, actions)
    }
}

@Composable
private fun ReceiverStatusScreen(
    connection: ConnectionState,
    ready: Readiness,
    held: Int,
    actions: ReceiverActions,
) {
    val colors = MaterialTheme.colorScheme
    val label = describeConnection(connection)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Status")
        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (label.good) colors.tertiary else colors.outline))
                Text(label.text, style = MaterialTheme.typography.bodyLarge)
            }
            Text(
                if (held == 0) "No messages held yet" else "$held messages on this phone",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (!ready.notificationsAllowed) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
                Text("Allow notifications", fontWeight = FontWeight.SemiBold)
                Text(
                    "Without it, alerts cannot show on this phone.",
                    color = colors.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
                PrimaryButton(onClick = actions.onAllowNotifications, modifier = Modifier.fillMaxWidth()) { Text("Allow") }
            }
        }
        if (!ready.batteryExempt) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(18.dp)) {
                Text("Keep it running", fontWeight = FontWeight.SemiBold)
                Text(
                    "Set battery use to unrestricted so alerts arrive when the screen is off.",
                    color = colors.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
                SecondaryButton(onClick = actions.onRequestBatteryExemption, modifier = Modifier.fillMaxWidth()) { Text("Fix") }
            }
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
                    // One row of actions: Show more on the left, Copy code on the right.
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (showMore) {
                            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Show less" else "Show more") }
                        }
                        Box(Modifier.weight(1f))
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
                                Text(if (copied) "Copied ✓" else "Copy code")
                            }
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
    ready: Readiness,
    themeMode: ThemeMode,
    updateState: UpdateState,
    actions: ReceiverActions,
    messages: List<ReceivedMessage>,
) {
    var settings by remember { mutableStateOf(app.receiverSettingsStore.load()) }
    val change = { updated: ReceiverSettings ->
        settings = updated
        app.receiverSettingsStore.save(updated)
    }
    var confirmRole by remember { mutableStateOf(false) }
    val apps = remember(messages) { appsSeen(messages) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Settings")

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

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Connection")
            KeyValueRow("Server", serverName(paired.serverUrl))
            RowDivider()
            KeyValueRow("Encryption", if (paired.encrypted) "On" else "Off")
            RowDivider()
            SecondaryButton(onClick = actions.onUnpair, danger = true, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Unpair this phone") }
            SecondaryButton(onClick = { confirmRole = true }, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { Text("Use as a sender instead") }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Phone setup")
            KeyValueRow(
                "Notifications",
                if (ready.notificationsAllowed) "On" else "Off, tap to fix",
                onClick = if (ready.notificationsAllowed) null else actions.onAllowNotifications,
            )
            RowDivider()
            KeyValueRow(
                "Battery optimisation",
                if (ready.batteryExempt) "Off" else "On, tap to fix",
                onClick = if (ready.batteryExempt) null else actions.onRequestBatteryExemption,
            )
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

        UpdateCard(updateState, actions.onCheckUpdate, actions.onInstallUpdate, actions.onAllowInstall)
    }

    if (confirmRole) {
        AlertDialog(
            onDismissRequest = { confirmRole = false },
            title = { Text("Change role?") },
            text = { Text("This unpairs the phone and clears the messages it holds. You then pick Sender or Receiver again and pair it with a new key from the dashboard.") },
            confirmButton = { TextButton(onClick = { confirmRole = false; actions.onChangeRole() }) { Text("Change role") } },
            dismissButton = { TextButton(onClick = { confirmRole = false }) { Text("Cancel") } },
        )
    }
}
