package com.notiforwarder.sender

/** An activity (package, class) that holds a maker's "allow this app to start by itself" list. */
data class SettingsPage(val packageName: String, val className: String)

/**
 * Where OnePlus, Oppo and Realme phones keep the auto-start list. Android has no standard page for
 * it and the names change between versions, so the caller tries each and falls back to the app's
 * own settings page when none opens. Other makers have no such list.
 */
fun autoStartPages(manufacturer: String): List<SettingsPage> = when (manufacturer.lowercase()) {
    "oneplus", "oppo", "realme" -> listOf(
        SettingsPage("com.oplus.battery", "com.oplus.startupapp.StartupAppListActivity"),
        SettingsPage("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        SettingsPage("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        SettingsPage("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
    )
    else -> emptyList()
}
