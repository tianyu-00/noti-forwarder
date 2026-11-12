package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit

/** Light, dark, or whatever the phone is set to. */
enum class ThemeMode {
    SYSTEM,
    LIGHT,
    DARK,
    ;

    fun isDark(systemIsDark: Boolean) = when (this) {
        SYSTEM -> systemIsDark
        LIGHT -> false
        DARK -> true
    }
}

interface ThemeStore {
    fun load(): ThemeMode
    fun save(mode: ThemeMode)
}

class PrefsThemeStore(context: Context, name: String = "theme") : ThemeStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun load(): ThemeMode =
        ThemeMode.entries.firstOrNull { it.name == prefs.getString(KEY, null) } ?: ThemeMode.SYSTEM

    override fun save(mode: ThemeMode) = prefs.edit { putString(KEY, mode.name) }

    private companion object {
        const val KEY = "mode"
    }
}
