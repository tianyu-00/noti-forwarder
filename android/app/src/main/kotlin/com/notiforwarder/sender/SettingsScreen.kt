package com.notiforwarder.sender

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import android.widget.Toast
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The connection, how the app looks, and where to fix phone settings. */
@Composable
internal fun SettingsScreen(
    paired: UiState.Paired,
    themeMode: ThemeMode,
    onThemeChange: (ThemeMode) -> Unit,
    ready: Readiness,
    onUnpair: () -> Unit,
    onOpenAccessSettings: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    developerMode: Boolean,
    onDeveloperUnlocked: () -> Unit,
    onDeveloperChange: (Boolean) -> Unit,
    updateState: UpdateState,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onAllowInstall: () -> Unit,
    practiceMode: Boolean,
    onPracticeChange: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val taps = remember { DeveloperTaps() }
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
            SecondaryButton(
                onClick = onUnpair,
                danger = true,
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            ) { Text("Unpair this phone") }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Appearance")
            Column(modifier = Modifier.padding(bottom = 10.dp)) {
                Choice(
                    options = listOf(ThemeMode.SYSTEM to "System", ThemeMode.LIGHT to "Light", ThemeMode.DARK to "Dark"),
                    selected = themeMode,
                    onSelect = onThemeChange,
                )
            }
        }

        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
            CardLabel("Phone setup")
            KeyValueRow(
                "Notification access",
                if (ready.accessGranted) "On" else "Off, tap to fix",
                onClick = if (ready.accessGranted) null else onOpenAccessSettings,
            )
            RowDivider()
            KeyValueRow(
                "Battery optimisation",
                if (ready.batteryExempt) "Off" else "On, tap to fix",
                onClick = if (ready.batteryExempt) null else onRequestBatteryExemption,
            )
            RowDivider()
            KeyValueRow("Auto-start", "Open settings", onClick = onOpenAutoStart)
            RowDivider()
            KeyValueRow(
                "Version",
                BuildConfig.VERSION_NAME,
                // Only the unlocking tap says anything: a message per tap queues up and lags behind the taps.
                onClick = {
                    if (!developerMode && taps.tap(System.currentTimeMillis())) {
                        onDeveloperUnlocked()
                        Toast.makeText(context, "Developer mode is on", Toast.LENGTH_SHORT).show()
                    }
                },
            )
        }

        UpdateCard(updateState, onCheckUpdate, onInstallUpdate, onAllowInstall)

        if (developerMode) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 10.dp)) {
                SwitchRow(
                    "Developer mode",
                    "Shows options meant for testing. Switch off to hide them.",
                    true,
                    onDeveloperChange,
                )
                RowDivider()
                SwitchRow(
                    "Practice mode",
                    "Replies from the dashboard are received and checked, but never sent, so nothing is charged. " +
                        "The dashboard shows them as practice.",
                    practiceMode,
                    onPracticeChange,
                )
            }
        }
    }
}

/** Check for a newer release and install it from inside the app. */
@Composable
private fun UpdateCard(state: UpdateState, onCheck: () -> Unit, onInstall: () -> Unit, onAllowInstall: () -> Unit) {
    NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 8.dp)) {
        CardLabel("App updates")
        KeyValueRow("Installed", BuildConfig.VERSION_NAME)
        RowDivider()
        val busy = state is UpdateState.Checking || state is UpdateState.Downloading || state is UpdateState.Installing
        Text(
            when (state) {
                UpdateState.Idle -> "Look for a newer version."
                UpdateState.Checking -> "Checking…"
                is UpdateState.UpToDate -> "You have the latest version."
                is UpdateState.Available -> "Version ${state.info.version} is available (${state.info.sizeBytes / 1_000_000} MB)."
                is UpdateState.Downloading -> "Downloading version ${state.info.version}… ${state.percent}%"
                is UpdateState.NeedsPermission -> "Android needs your permission first: allow this app to install apps, then come back."
                UpdateState.Installing -> "Android is asking you to confirm the installation."
                is UpdateState.Failed -> state.message
            },
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
            color = if (state is UpdateState.Failed) androidx.compose.material3.MaterialTheme.colorScheme.error
            else androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp),
        )
        when (state) {
            is UpdateState.Available ->
                PrimaryButton(onClick = onInstall, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { Text("Download and install") }
            is UpdateState.NeedsPermission ->
                PrimaryButton(onClick = onAllowInstall, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { Text("Allow installing") }
            else ->
                SecondaryButton(
                    onClick = onCheck,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    enabled = !busy,
                ) { Text(if (state is UpdateState.Failed) "Try again" else "Check for updates") }
        }
    }
}
