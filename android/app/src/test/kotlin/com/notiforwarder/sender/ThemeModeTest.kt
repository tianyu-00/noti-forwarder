package com.notiforwarder.sender

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ThemeModeTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `system follows the phone, light and dark ignore it`() {
        assertTrue(ThemeMode.SYSTEM.isDark(systemIsDark = true))
        assertFalse(ThemeMode.SYSTEM.isDark(systemIsDark = false))
        assertFalse(ThemeMode.LIGHT.isDark(systemIsDark = true))
        assertTrue(ThemeMode.DARK.isDark(systemIsDark = false))
    }

    @Test
    fun `a fresh install follows the system`() {
        val store = PrefsThemeStore(context, name = "theme-fresh-${System.nanoTime()}")

        assertEquals(ThemeMode.SYSTEM, store.load())
    }

    @Test
    fun `the choice survives a restart`() {
        val name = "theme-persist-${System.nanoTime()}"
        PrefsThemeStore(context, name).save(ThemeMode.LIGHT)

        assertEquals(ThemeMode.LIGHT, PrefsThemeStore(context, name).load())
    }

    @Test
    fun `an unknown stored value falls back to the system`() {
        val name = "theme-garbage-${System.nanoTime()}"
        context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().putString("mode", "purple").commit()

        assertEquals(ThemeMode.SYSTEM, PrefsThemeStore(context, name).load())
    }
}
