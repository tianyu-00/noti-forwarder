package com.notiforwarder.sender

import android.content.Context
import android.content.Intent
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What leaves the phone: texts, app notifications, and which apps. Everything here is applied before sending. */
@Composable
internal fun ForwardScreen(
    settings: CaptureSettings,
    onChange: (CaptureSettings) -> Unit,
    onRepliesChange: (Boolean) -> Unit,
    /** The SIMs in the phone, or null while the app may not list them. */
    sims: List<SimOption>?,
    onAllowSimAccess: () -> Unit,
) {
    val context = LocalContext.current
    var apps by remember { mutableStateOf<List<AppEntry>?>(null) }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { apps = withContext(Dispatchers.IO) { launcherApps(context) } }
    val shown = apps?.let { filterApps(it, query) }
    val colors = MaterialTheme.colorScheme

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 20.dp, bottom = 14.dp)) {
                ScreenTitle("Forward")
                NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 10.dp)) {
                    SwitchRow("Text messages", "Send every SMS you receive", settings.sendSms) {
                        onChange(settings.copy(sendSms = it))
                    }
                    RowDivider()
                    SwitchRow("App notifications", "Send what other apps show you", settings.sendNotifications) {
                        onChange(settings.copy(sendNotifications = it))
                    }
                    RowDivider()
                    SwitchRow(
                        "Clear after forwarding",
                        "Dismisses each forwarded notification on this phone. Android drops new notifications once an " +
                            "app has 50 waiting, so turn this on for a phone you leave untouched.",
                        settings.clearAfterForwarding,
                    ) { onChange(settings.copy(clearAfterForwarding = it)) }
                    RowDivider()
                    SwitchRow(
                        "Reply from the dashboard",
                        "Send the texts you type on the dashboard from this phone's number. Asks for permission to " +
                            "send texts, which your carrier may charge for.",
                        settings.allowReplies,
                        onRepliesChange,
                    )
                    RowDivider()
                    SimRow(settings.replySim, sims, onAllowSimAccess) { onChange(settings.copy(replySim = it)) }
                    // Practice mode is a testing tool: hidden until developer mode is unlocked (or while it is
                    // still on, so it can never be left on out of sight).
                    if (settings.developerMode || settings.practiceReplies) {
                        RowDivider()
                        SwitchRow(
                            "Practice mode",
                            "Replies are received and checked, but never sent, so nothing is charged. The dashboard " +
                                "shows them as practice.",
                            settings.practiceReplies,
                        ) { onChange(settings.copy(practiceReplies = it)) }
                    }
                }
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search apps") },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    val off = settings.blockedApps.size
                    Text(
                        if (off == 0) "All apps on" else "$off app${if (off == 1) "" else "s"} switched off",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                    )
                    if (off > 0) {
                        Text(
                            "Turn all on",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = colors.primary,
                            modifier = Modifier.clickable { onChange(settings.copy(blockedApps = emptySet())) },
                        )
                    }
                }
            }
        }
        when {
            shown == null -> item { Text("Loading apps…", color = colors.onSurfaceVariant, modifier = Modifier.padding(4.dp)) }
            shown.isEmpty() -> item { Text("No apps match.", color = colors.onSurfaceVariant, modifier = Modifier.padding(4.dp)) }
            else -> {
                itemsIndexed(shown, key = { _, app -> app.packageName }) { index, app ->
                    val top = if (index == 0) 22.dp else 0.dp
                    val bottom = if (index == shown.lastIndex) 22.dp else 0.dp
                    val on = !settings.isBlocked(app.packageName)
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(top, top, bottom, bottom))
                            .background(colors.surfaceContainer),
                    ) {
                        if (index > 0) RowDivider()
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(if (on) colors.primaryContainer else colors.surfaceVariant),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    app.label.firstOrNull()?.uppercase() ?: "?",
                                    fontWeight = FontWeight.Bold,
                                    color = if (on) colors.onPrimaryContainer else colors.onSurfaceVariant,
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(app.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    app.packageName,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Switch(
                                checked = on,
                                onCheckedChange = { allowed ->
                                    onChange(settings.withAppBlocked(app.packageName, blocked = !allowed))
                                },
                            )
                        }
                    }
                }
                item { Box(Modifier.size(20.dp)) }
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, detail: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

/** Which SIM sends replies. Picking is needed with two SIMs: the phone never chooses one for you. */
@Composable
private fun SimRow(chosen: Int?, sims: List<SimOption>?, onAllowAccess: () -> Unit, onChoose: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = sims?.firstOrNull { it.id == chosen }
    val detail = when {
        sims == null -> "Allow phone access so the app can list your SIMs."
        chosen != null && current == null -> "The chosen SIM is not in the phone. Choose again."
        current != null -> current.label
        sims.size > 1 -> "Not chosen yet. Replies will not send until you choose."
        else -> "The phone's only SIM"
    }
    Row(
        modifier = Modifier.fillMaxWidth().clickable { if (sims == null) onAllowAccess() else open = true }.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("SIM for replies", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            if (sims == null) "Allow" else "Choose",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
    }
    if (open && sims != null) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text("SIM for replies") },
            text = {
                Column {
                    sims.forEach { sim ->
                        Row(
                            modifier = Modifier.fillMaxWidth().clickable {
                                onChoose(sim.id)
                                open = false
                            }.padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = sim.id == chosen, onClick = null)
                            Text(sim.label, modifier = Modifier.padding(start = 12.dp))
                        }
                    }
                    if (sims.isEmpty()) Text("No SIM found in this phone.")
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
        )
    }
}

private fun launcherApps(context: Context): List<AppEntry> {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(launcher, 0)
        .map { AppEntry(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
        .distinctBy { it.packageName }
        .filter { it.packageName != context.packageName }
}
