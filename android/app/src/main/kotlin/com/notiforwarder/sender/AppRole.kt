package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit

/** What this phone does. A sender forwards its notifications and texts; a receiver shows your alerts. */
enum class AppRole { Sender, Receiver }

/**
 * The role to use. None yet means a new install, so the app asks. A phone that was paired before roles
 * existed is a sender and is never asked.
 */
fun effectiveRole(stored: AppRole?, paired: Boolean): AppRole? = stored ?: if (paired) AppRole.Sender else null

interface RoleStore {
    fun load(): AppRole?
    fun save(role: AppRole)
    fun clear()
}

class PrefsRoleStore(context: Context, name: String = "app_role") : RoleStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun load(): AppRole? = AppRole.entries.firstOrNull { it.name == prefs.getString(KEY, null) }

    override fun save(role: AppRole) = prefs.edit { putString(KEY, role.name) }

    override fun clear() = prefs.edit { remove(KEY) }

    private companion object {
        const val KEY = "role"
    }
}
