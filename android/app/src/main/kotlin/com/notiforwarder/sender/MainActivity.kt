package com.notiforwarder.sender

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private var accessGranted by mutableStateOf(false)
    private var notificationsAllowed by mutableStateOf(true)
    private var batteryExempt by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as NotiApp
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainScreen(
                        app = app,
                        accessGranted = accessGranted,
                        notificationsAllowed = notificationsAllowed,
                        batteryExempt = batteryExempt,
                        onOpenAccessSettings = {
                            // Android has no runtime prompt for this: the user must switch it on here.
                            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        },
                        onRequestBatteryExemption = {
                            startActivity(
                                Intent(
                                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    Uri.parse("package:$packageName"),
                                ),
                            )
                        },
                        onScan = { onResult -> scanQr(onResult) },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val app = application as NotiApp
        accessGranted = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        notificationsAllowed = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        batteryExempt = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        app.controller.refresh() // picks up a revocation seen in the background
        if (app.store.load() != null) {
            // Android 12+ only allows starting a foreground service from a visible app like this.
            ContextCompat.startForegroundService(this, Intent(this, KeepAliveService::class.java))
        }
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
    app: NotiApp,
    accessGranted: Boolean,
    notificationsAllowed: Boolean,
    batteryExempt: Boolean,
    onOpenAccessSettings: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onScan: ((String) -> Unit) -> Unit,
) {
    val controller = app.controller
    val state by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    var queueStatus by remember { mutableStateOf<QueueStatus?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    // Refresh the queue numbers while the screen is visible.
    LaunchedEffect(Unit) {
        while (true) {
            queueStatus = withContext(Dispatchers.IO) { app.statusReader.snapshot() }
            now = System.currentTimeMillis()
            delay(3_000)
        }
    }

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

        Text("Sending", style = MaterialTheme.typography.titleMedium)
        queueStatus?.let { q ->
            Text("Waiting to send: ${q.queued}")
            Text("Last successful send: ${describeAgo(q.lastSuccessAt, now)}")
            if (q.quarantined > 0) {
                Text(
                    "Rejected by the server and kept: ${q.quarantined}",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        } ?: Text("Loading…")

        Text("Notification access", style = MaterialTheme.typography.titleMedium)
        if (accessGranted) {
            Text("Granted. Notifications on this phone are queued and forwarded to your server.")
        } else {
            Text("Not granted. Without it nothing can be forwarded.")
            Button(onClick = onOpenAccessSettings, modifier = Modifier.fillMaxWidth()) {
                Text("Open notification access settings")
            }
        }

        Text("Keep it running", style = MaterialTheme.typography.titleMedium)
        if (!notificationsAllowed) {
            Text("Allow notifications so Android can show the \"running\" notice that keeps the app alive.")
            Button(
                onClick = { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Allow notifications") }
        }
        if (batteryExempt) {
            Text("Battery optimisation is off for this app.")
        } else {
            Text("Battery optimisation may stop this app in the background. On OnePlus, also allow auto-start.")
            Button(onClick = onRequestBatteryExemption, modifier = Modifier.fillMaxWidth()) {
                Text("Turn off battery optimisation")
            }
        }
    }
}
