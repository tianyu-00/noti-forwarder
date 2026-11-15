package com.notiforwarder.sender

import android.Manifest
import android.graphics.Color
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.ManagedActivityResultLauncher
import android.content.Context
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
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
        if (app.store.load() != null && app.role == AppRole.Receiver) {
            ContextCompat.startForegroundService(this, Intent(this, ReceiverService::class.java))
        }
        if (app.store.load() != null && app.role != AppRole.Receiver) {
            // Android 12+ only allows starting a foreground service from a visible app like this.
            ContextCompat.startForegroundService(this, Intent(this, KeepAliveService::class.java))
        }
    }

    /**
     * Opens this app's info page. No app can open the maker's own auto-start list (OnePlus keeps it
     * behind a permission), so the screen next to the button says which taps to make from here.
     */
    private fun openAutoStart() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
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
    var activity by remember { mutableStateOf<ActivityView?>(null) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    val hostActivity = LocalActivity.current!!
    val updateState by app.updater.state.collectAsStateWithLifecycle()
    // Asks for a permission with the system dialog, or, when Android no longer shows it (refused too often),
    // opens this app's permission page so the button is never dead.
    val ask = { permission: String, launcher: ManagedActivityResultLauncher<String, Boolean> ->
        val prefs = app.getSharedPreferences("permission_asks", Context.MODE_PRIVATE)
        val step = nextAskStep(
            askedBefore = prefs.getBoolean(permission, false),
            canShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(hostActivity, permission),
        )
        when (step) {
            AskStep.Prompt -> {
                prefs.edit().putBoolean(permission, true).apply()
                launcher.launch(permission)
            }
            AskStep.OpenSettings -> {
                Toast.makeText(app, "Turn this permission on in the page that opens", Toast.LENGTH_LONG).show()
                app.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val askSms = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    var settings by remember { mutableStateOf(app.settingsStore.load()) }
    val changeSettings = { updated: CaptureSettings ->
        settings = updated
        app.settingsStore.save(updated)
        app.reportSims() // the allowed SIMs may have changed; does nothing if the list is the same
    }
    // Replies are only switched on once the user has allowed this app to send texts.
    val askSendSms = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            changeSettings(settings.copy(allowReplies = true))
            app.sendReplies()
        }
    }
    // The SIMs, listed once the user allows phone access (Android hides them otherwise).
    var sims by remember { mutableStateOf(app.simLookup.activeSims()) }
    val askPhoneState = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        sims = app.simLookup.activeSims()
        app.reportSims()
    }
    // Back from the app's permission page: the user may have switched the permission on there.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        sims = app.simLookup.activeSims()
        app.reportSims()
        // Back from Android's "install unknown apps" page: carry on installing a downloaded update.
        scope.launch(Dispatchers.IO) { app.updater.continueInstall() }
    }
    val changeReplies = { on: Boolean ->
        val allowed = ContextCompat.checkSelfPermission(app, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
        when {
            !on -> changeSettings(settings.copy(allowReplies = false))
            allowed -> {
                changeSettings(settings.copy(allowReplies = true))
                app.sendReplies()
            }
            else -> ask(Manifest.permission.SEND_SMS, askSendSms)
        }
    }
    var tab by rememberSaveable { mutableStateOf(Tab.Status) }

    // Refresh the queue numbers while the screen is visible.
    LaunchedEffect(Unit) {
        while (true) {
            queueStatus = withContext(Dispatchers.IO) { app.statusReader.snapshot() }
            now = System.currentTimeMillis()
            activity = withContext(Dispatchers.IO) { loadActivity(app, now) }
            delay(3_000)
        }
    }

    val paired = state as? UiState.Paired
    var chosenRole by remember { mutableStateOf(app.roleStore.load()) }
    val role = effectiveRole(chosenRole, paired != null)
    // Switching role unpairs this phone (a sender and a receiver use different credentials) and asks again.
    val changeRole = {
        controller.unpair()
        app.roleStore.clear()
        chosenRole = null
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f)) {
            if (role == null) {
                RoleScreen(onChoose = { picked ->
                    app.roleStore.save(picked)
                    chosenRole = picked
                })
            } else if (paired == null) {
                PairingScreen(
                    role = role,
                    state = state,
                    onScan = { onScan { text -> scope.launch { controller.pairFromQr(text) } } },
                    onPairManual = { address, key, encryptionKey ->
                        scope.launch { controller.pairManual(address, key, encryptionKey) }
                    },
                )
            } else if (role == AppRole.Receiver) {
                ReceiverScreen(
                    app = app,
                    paired = paired,
                    ready = ready,
                    themeMode = themeMode,
                    updateState = updateState,
                    tab = currentTab(tab, paired = true),
                    actions = ReceiverActions(
                        onUnpair = controller::unpair,
                        onChangeRole = changeRole,
                        onAllowNotifications = { ask(Manifest.permission.POST_NOTIFICATIONS, askNotifications) },
                        onRequestBatteryExemption = onRequestBatteryExemption,
                        onThemeChange = onThemeChange,
                        onCheckUpdate = { scope.launch(Dispatchers.IO) { app.updater.check() } },
                        onInstallUpdate = { scope.launch(Dispatchers.IO) { app.updater.downloadAndInstall() } },
                        onAllowInstall = {
                            app.startActivity(
                                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        },
                    ),
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
                            onAllowNotifications = { ask(Manifest.permission.POST_NOTIFICATIONS, askNotifications) },
                            onAllowSms = { ask(Manifest.permission.RECEIVE_SMS, askSms) },
                            onOpenAutoStart = onOpenAutoStart,
                        )
                    }
                    Tab.Forward -> ForwardScreen(
                    settings = settings,
                    onChange = changeSettings,
                    onRepliesChange = changeReplies,
                    sims = sims,
                    onAllowSimAccess = { ask(Manifest.permission.READ_PHONE_STATE, askPhoneState) },
                )
                    Tab.Activity, Tab.Alerts -> ActivityScreen(activity)
                    Tab.Settings -> SettingsScreen(
                        paired = paired,
                        themeMode = themeMode,
                        onThemeChange = onThemeChange,
                        onUnpair = controller::unpair,
                        developerMode = settings.developerMode,
                        onDeveloperUnlocked = { changeSettings(settings.copy(developerMode = true)) },
                        onChangeRole = changeRole,
                        onDeveloperChange = { changeSettings(withDeveloperMode(settings, it)) },
                        updateState = updateState,
                        onCheckUpdate = { scope.launch(Dispatchers.IO) { app.updater.check() } },
                        onInstallUpdate = { scope.launch(Dispatchers.IO) { app.updater.downloadAndInstall() } },
                        onAllowInstall = {
                            app.startActivity(
                                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        },
                        practiceMode = settings.practiceReplies,
                        onPracticeChange = { changeSettings(settings.copy(practiceReplies = it)) },
                    )
                }
            }
        }
        if (paired != null && role != null) {
            // A tab the other role has (a stale choice after a role change) falls back to Status.
            val tabs = visibleTabs(paired = true, role = role)
            BottomBar(tabs = tabs, current = if (tab in tabs) tab else Tab.Status, onSelect = { tab = it })
        }
    }
}

/** The latest sends for the Activity tab. Blocking (database and app-name lookups): call it off the main thread. */
private fun loadActivity(app: NotiApp, now: Long): ActivityView {
    val rows = app.queue.recent(ACTIVITY_LIMIT)
    val labels = PackageLabels(app.packageManager)
    val startOfToday = java.time.LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
    return ActivityView(toActivityItems(rows, labels::labelFor, now), summarise(rows, startOfToday))
}

private const val ACTIVITY_LIMIT = 50
