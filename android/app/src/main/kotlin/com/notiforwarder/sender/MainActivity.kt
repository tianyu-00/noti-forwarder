package com.notiforwarder.sender

import android.Manifest
import android.content.ComponentName
import android.graphics.Color
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
    private var smsAllowed by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as NotiApp
        setContent {
            var themeMode by remember { mutableStateOf(app.themeStore.load()) }
            val dark = themeMode.isDark(isSystemInDarkTheme())
            // Draw behind the system bars (Android 15+ requires it); the icons must match the page.
            LaunchedEffect(dark) {
                val bar = if (dark) {
                    SystemBarStyle.dark(Color.TRANSPARENT)
                } else {
                    SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = bar, navigationBarStyle = bar)
            }
            NotiTheme(dark) {
                Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                    MainScreen(
                        app = app,
                        ready = Readiness(accessGranted, notificationsAllowed, batteryExempt, smsAllowed),
                        onOpenAutoStart = ::openAutoStart,
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
                        themeMode = themeMode,
                        onThemeChange = {
                            themeMode = it
                            app.themeStore.save(it)
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
        smsAllowed = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED
        app.controller.refresh() // picks up a revocation seen in the background
        app.deviceStream.wake() // opening the app is a good moment to retry a connection that is waiting
        if (app.store.load() != null) {
            // Android 12+ only allows starting a foreground service from a visible app like this.
            ContextCompat.startForegroundService(this, Intent(this, KeepAliveService::class.java))
        }
    }

    /**
     * Opens the page where this phone's maker keeps the "start by itself" list, if we know it. Names
     * differ between versions, so each is tried and the app's own settings page is the fallback.
     */
    private fun openAutoStart() {
        val pages = autoStartPages(Build.MANUFACTURER).map { page ->
            Intent().setComponent(ComponentName(page.packageName, page.className))
        }
        val own = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        for (intent in pages + own) {
            try {
                startActivity(intent)
                return
            } catch (_: RuntimeException) {
                // not on this phone: try the next page
            }
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
    ready: Readiness,
    onOpenAccessSettings: () -> Unit,
    onRequestBatteryExemption: () -> Unit,
    onOpenAutoStart: () -> Unit,
    themeMode: ThemeMode,
    onThemeChange: (ThemeMode) -> Unit,
    onScan: ((String) -> Unit) -> Unit,
) {
    val controller = app.controller
    val state by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var queueStatus by remember { mutableStateOf<QueueStatus?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val askSms = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    var settings by remember { mutableStateOf(app.settingsStore.load()) }
    val changeSettings = { updated: CaptureSettings ->
        settings = updated
        app.settingsStore.save(updated)
    }
    var tab by rememberSaveable { mutableStateOf(Tab.Status) }

    // Refresh the queue numbers while the screen is visible.
    LaunchedEffect(Unit) {
        while (true) {
            queueStatus = withContext(Dispatchers.IO) { app.statusReader.snapshot() }
            now = System.currentTimeMillis()
            delay(3_000)
        }
    }

    val paired = state as? UiState.Paired
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f)) {
            if (paired == null) {
                PairingScreen(
                    state = state,
                    onScan = { onScan { text -> scope.launch { controller.pairFromQr(text) } } },
                    onPairManual = { address, key, encryptionKey ->
                        scope.launch { controller.pairManual(address, key, encryptionKey) }
                    },
                )
            } else {
                when (currentTab(tab, paired = true)) {
                    Tab.Status -> {
                        val connection by app.deviceStream.state.collectAsState()
                        StatusScreen(
                            paired = paired,
                            connection = connection,
                            queue = queueStatus,
                            now = now,
                            settings = settings,
                            ready = ready,
                            onOpenAccessSettings = onOpenAccessSettings,
                            onRequestBatteryExemption = onRequestBatteryExemption,
                            onAllowNotifications = { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) },
                            onAllowSms = { askSms.launch(Manifest.permission.RECEIVE_SMS) },
                            onOpenAutoStart = onOpenAutoStart,
                        )
                    }
                    Tab.Forward -> ForwardScreen(settings = settings, onChange = changeSettings)
                    Tab.Settings -> SettingsScreen(
                        paired = paired,
                        themeMode = themeMode,
                        onThemeChange = onThemeChange,
                        ready = ready,
                        onUnpair = controller::unpair,
                        onOpenAccessSettings = onOpenAccessSettings,
                        onRequestBatteryExemption = onRequestBatteryExemption,
                        onOpenAutoStart = onOpenAutoStart,
                    )
                }
            }
        }
        if (paired != null) BottomBar(tabs = visibleTabs(paired = true), current = tab, onSelect = { tab = it })
    }
}
