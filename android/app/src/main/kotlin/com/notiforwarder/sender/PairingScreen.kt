package com.notiforwarder.sender

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Shown until the phone is paired: scan the dashboard's QR code, or type the details. */
@Composable
internal fun PairingScreen(
    state: UiState,
    onScan: () -> Unit,
    onPairManual: (address: String, key: String, encryptionKey: String) -> Unit,
) {
    var address by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var encryptionKey by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScreenTitle("Notiforwarder")
        NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            if (state is UiState.Pairing) {
                Text("Pairing…", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                return@NotiCard
            }
            Text("Not paired", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "Open the dashboard, choose Add phone, and scan the code it shows.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 14.dp),
            )
            (state as? UiState.Unpaired)?.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 12.dp))
            }
            PrimaryButton(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("Scan QR code") }
        }
        if (state !is UiState.Pairing) {
            NotiCard(padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
                CardLabel("Or enter the details by hand")
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        label = { Text("Server address") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = key,
                        onValueChange = { key = it },
                        label = { Text("Security key") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = encryptionKey,
                        onValueChange = { encryptionKey = it },
                        label = { Text("Encryption key (optional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    SecondaryButton(
                        onClick = { onPairManual(address, key, encryptionKey) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Pair") }
                }
            }
        }
    }
}
