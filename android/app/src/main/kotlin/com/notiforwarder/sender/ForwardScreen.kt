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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
internal fun ForwardScreen(settings: CaptureSettings, onChange: (CaptureSettings) -> Unit) {
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

private fun launcherApps(context: Context): List<AppEntry> {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(launcher, 0)
        .map { AppEntry(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
        .distinctBy { it.packageName }
        .filter { it.packageName != context.packageName }
}
