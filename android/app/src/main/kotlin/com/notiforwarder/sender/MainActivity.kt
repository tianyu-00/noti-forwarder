package com.notiforwarder.sender

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var accessGranted by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val controller = (application as NotiApp).controller
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainScreen(
                        controller = controller,
                        accessGranted = accessGranted,
                        onOpenAccessSettings = {
                            // Android has no runtime prompt for this: the user must switch it on here.
                            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        },
                        onScan = { onResult -> scanQr(onResult) },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        accessGranted = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        (application as NotiApp).controller.refresh() // picks up a revocation seen in the background
    }

    private fun scanQr(onResult: (String) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let(onResult) }
            .addOnFailureListener {
                Toast.makeText(this, "Could not scan. Type the address and key instead.", Toast.LENGTH_LONG).show()
            }
    }
}

@Composable
private fun MainScreen(
    controller: PairingController,
    accessGranted: Boolean,
    onOpenAccessSettings: () -> Unit,
    onScan: ((String) -> Unit) -> Unit,
) {
    val state by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Notiforwarder", style = MaterialTheme.typography.headlineMedium)

        when (val s = state) {
            is UiState.Paired -> {
                Text("Paired", style = MaterialTheme.typography.titleMedium)
                Text("Server: ${s.serverUrl}")
                OutlinedButton(onClick = controller::unpair) { Text("Unpair this phone") }
            }
            UiState.Pairing -> Text("Pairing…")
            is UiState.Unpaired -> {
                Text("Not paired", style = MaterialTheme.typography.titleMedium)
                s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(
                    onClick = { onScan { text -> scope.launch { controller.pairFromQr(text) } } },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Scan QR code") }
                Text("or enter the details by hand")
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
                OutlinedButton(
                    onClick = { scope.launch { controller.pairManual(address, key) } },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Pair") }
            }
        }

        Text("Notification access", style = MaterialTheme.typography.titleMedium)
        if (accessGranted) {
            Text("Granted. Notifications on this phone are forwarded to your server.")
        } else {
            Text("Not granted. Without it nothing can be forwarded.")
            Button(onClick = onOpenAccessSettings, modifier = Modifier.fillMaxWidth()) {
                Text("Open notification access settings")
            }
        }
    }
}
