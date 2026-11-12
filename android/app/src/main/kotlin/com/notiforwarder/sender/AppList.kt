package com.notiforwarder.sender

/** An installed app the user can switch notifications on or off for. */
data class AppEntry(val packageName: String, val label: String)

/** Apps sorted by name, narrowed by a search over the name and the package. */
fun filterApps(apps: List<AppEntry>, query: String): List<AppEntry> {
    val needle = query.trim().lowercase()
    return apps
        .filter { needle.isEmpty() || needle in it.label.lowercase() || needle in it.packageName.lowercase() }
        .sortedBy { it.label.lowercase() }
}
