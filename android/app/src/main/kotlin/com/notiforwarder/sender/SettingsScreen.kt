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

        if (developerMode) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp, vertical = 10.dp)) {
                SwitchRow(
                    "Developer mode",
                    "Shows options meant for testing, like practice mode on the Forward tab. Switch off to hide them.",
                    true,
                    onDeveloperChange,
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
                onClick = {
                    if (developerMode) {
                        Toast.makeText(context, "Developer mode is already on", Toast.LENGTH_SHORT).show()
                    } else {
                        when (val r = taps.tap(System.currentTimeMillis())) {
                            TapResult.Nothing -> {}
                            is TapResult.Remaining -> Toast.makeText(
                                context,
                                "${r.taps} more ${if (r.taps == 1) "tap" else "taps"} to turn on developer mode",
                                Toast.LENGTH_SHORT,
                            ).show()
                            TapResult.Unlocked -> {
                                onDeveloperUnlocked()
                                Toast.makeText(context, "Developer mode is on", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                },
            )
        }
    }
}
