package com.notiforwarder.sender

enum class AlertMode { All, CodesOnly }

/** What a receiver alerts for. Applied on this phone, to messages it has already received. */
data class ReceiverSettings(
    val enabled: Boolean = true,
    val mode: AlertMode = AlertMode.All,
    /** "sms" and/or "notification". */
    val types: Set<String> = setOf("sms", "notification"),
    /** Packages whose notifications never alert. */
    val blockedApps: Set<String> = emptySet(),
    /** Tell me when a sender phone stops checking in, and when it is back. */
    val quietAlerts: Boolean = true,
)

interface ReceiverSettingsStore {
    fun load(): ReceiverSettings
    fun save(settings: ReceiverSettings)
}

class PrefsReceiverSettingsStore(context: android.content.Context, name: String = "receiver_settings") : ReceiverSettingsStore {
    private val prefs = context.getSharedPreferences(name, android.content.Context.MODE_PRIVATE)

    override fun load() = ReceiverSettings(
        enabled = prefs.getBoolean(ENABLED, true),
        mode = AlertMode.entries.firstOrNull { it.name == prefs.getString(MODE, null) } ?: AlertMode.All,
        types = prefs.getStringSet(TYPES, null)?.toSet() ?: setOf("sms", "notification"),
        blockedApps = prefs.getStringSet(BLOCKED, emptySet())?.toSet().orEmpty(),
        quietAlerts = prefs.getBoolean(QUIET, true),
    )

    override fun save(settings: ReceiverSettings) = prefs.edit()
        .putBoolean(ENABLED, settings.enabled)
        .putString(MODE, settings.mode.name)
        .putStringSet(TYPES, settings.types)
        .putStringSet(BLOCKED, settings.blockedApps)
        .putBoolean(QUIET, settings.quietAlerts)
        .apply()

    private companion object {
        const val ENABLED = "enabled"
        const val MODE = "mode"
        const val TYPES = "types"
        const val BLOCKED = "blockedApps"
        const val QUIET = "quietAlerts"
    }
}

/** Remembers that the first sync after pairing has happened, so the history it brings in is not announced. */
class PrefsSyncState(context: android.content.Context, name: String = "receiver_sync") : SyncState {
    private val prefs = context.getSharedPreferences(name, android.content.Context.MODE_PRIVATE)

    override var seeded: Boolean
        get() = prefs.getBoolean(SEEDED, false)
        set(value) = prefs.edit().putBoolean(SEEDED, value).apply()

    fun reset() = prefs.edit().clear().apply()

    private companion object {
        const val SEEDED = "seeded"
    }
}
