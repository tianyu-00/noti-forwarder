package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit

/**
 * What the user allows to leave this phone. Applied before anything is queued, so filtered
 * items never leave the device. By default everything is forwarded.
 */
data class CaptureSettings(
    val sendSms: Boolean = true,
    val sendNotifications: Boolean = true,
    /** Package names whose notifications are never forwarded. */
    val blockedApps: Set<String> = emptySet(),
) {
    fun isBlocked(packageName: String) = packageName in blockedApps

    fun withAppBlocked(packageName: String, blocked: Boolean) =
        copy(blockedApps = if (blocked) blockedApps + packageName else blockedApps - packageName)
}

interface SettingsStore {
    fun load(): CaptureSettings
    fun save(settings: CaptureSettings)
}

class PrefsSettingsStore(context: Context, name: String = "capture_settings") : SettingsStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun load() = CaptureSettings(
        sendSms = prefs.getBoolean(SMS, true),
        sendNotifications = prefs.getBoolean(NOTIFICATIONS, true),
        blockedApps = prefs.getStringSet(BLOCKED, emptySet())?.toSet().orEmpty(),
    )

    override fun save(settings: CaptureSettings) = prefs.edit {
        putBoolean(SMS, settings.sendSms)
        putBoolean(NOTIFICATIONS, settings.sendNotifications)
        putStringSet(BLOCKED, settings.blockedApps)
    }

    private companion object {
        const val SMS = "sendSms"
        const val NOTIFICATIONS = "sendNotifications"
        const val BLOCKED = "blockedApps"
    }
}
