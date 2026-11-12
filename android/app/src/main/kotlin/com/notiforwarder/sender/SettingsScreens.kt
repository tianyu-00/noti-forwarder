package com.notiforwarder.sender

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The two switches. Both off, one on, or both on are all valid. */
@Composable
internal fun ForwardingSwitches(settings: CaptureSettings, onChange: (CaptureSettings) -> Unit) {
    SwitchRow("Send text messages (SMS)", settings.sendSms) { onChange(settings.copy(sendSms = it)) }
    SwitchRow("Send app notifications", settings.sendNotifications) { onChange(settings.copy(sendNotifications = it)) }
    SwitchRow("Clear notifications after forwarding", settings.clearAfterForwarding) {
        onChange(settings.copy(clearAfterForwarding = it))
    }
    Text(
        "Dismisses each forwarded notification on this phone. Android drops new notifications " +
            "once an app has 50 waiting, so turn this on for a phone you leave untouched.",
    )
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

/** Every launcher app with a switch. Off means its notifications never leave the phone. */
@Composable
internal fun AppsScreen(settings: CaptureSettings, onChange: (CaptureSettings) -> Unit, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    var apps by remember { mutableStateOf<List<AppEntry>?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { apps = withContext(Dispatchers.IO) { launcherApps(context) } }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp)) {
        SecondaryButton(onClick = onBack) { Text("Back") }
        Text("Apps to forward", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp))
        Text("Switch an app off to keep its notifications on this phone.")
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search apps") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        )
        val shown = apps?.let { filterApps(it, query) }
        when {
            shown == null -> Text("Loading apps…")
            shown.isEmpty() -> Text("No apps match.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(shown, key = { it.packageName }) { app ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(app.label)
                            Text(app.packageName, style = MaterialTheme.typography.bodySmall)
                        }
                        Switch(
                            checked = !settings.isBlocked(app.packageName),
                            onCheckedChange = { allowed ->
                                onChange(settings.withAppBlocked(app.packageName, blocked = !allowed))
                            },
                        )
                    }
                }
            }
        }
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
