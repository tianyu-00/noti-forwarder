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
class SettingsStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `by default everything is forwarded and no app is blocked`() {
        val settings = CaptureSettings()

        assertTrue(settings.sendSms)
        assertTrue(settings.sendNotifications)
        assertEquals(emptySet<String>(), settings.blockedApps)
    }

    @Test
    fun `a fresh install loads the defaults`() {
        val store = PrefsSettingsStore(context, name = "fresh-${System.nanoTime()}")

        assertEquals(CaptureSettings(), store.load())
    }

    @Test
    fun `settings survive a restart`() {
        val name = "persist-${System.nanoTime()}"
        PrefsSettingsStore(context, name).save(
            CaptureSettings(sendSms = false, sendNotifications = true, blockedApps = setOf("com.game", "com.news")),
        )

        val reloaded = PrefsSettingsStore(context, name).load()

        assertFalse(reloaded.sendSms)
        assertTrue(reloaded.sendNotifications)
        assertEquals(setOf("com.game", "com.news"), reloaded.blockedApps)
    }

    @Test
    fun `turning an app off and on again updates the blocked list`() {
        val settings = CaptureSettings()

        val off = settings.withAppBlocked("com.game", blocked = true)
        assertTrue(off.isBlocked("com.game"))
        assertFalse(off.isBlocked("com.other"))

        assertFalse(off.withAppBlocked("com.game", blocked = false).isBlocked("com.game"))
    }

    @Test
    fun `replies from the dashboard are off until the user turns them on, and the choice is kept`() {
        assertFalse(CaptureSettings().allowReplies)
        val name = "replies-${System.nanoTime()}"
        PrefsSettingsStore(context, name).save(CaptureSettings(allowReplies = true))

        assertTrue(PrefsSettingsStore(context, name).load().allowReplies)
    }

    @Test
    fun `practice mode and the chosen SIM start empty and are kept`() {
        assertFalse(CaptureSettings().practiceReplies)
        assertEquals(null, CaptureSettings().replySim)
        val name = "sim-${System.nanoTime()}"
        PrefsSettingsStore(context, name).save(CaptureSettings(practiceReplies = true, replySim = 5))

        val reloaded = PrefsSettingsStore(context, name).load()

        assertTrue(reloaded.practiceReplies)
        assertEquals(5, reloaded.replySim)
        PrefsSettingsStore(context, name).save(reloaded.copy(replySim = null))
        assertEquals(null, PrefsSettingsStore(context, name).load().replySim)
    }

    @Test
    fun `developer mode is hidden until it is unlocked, and stays unlocked`() {
        assertFalse(CaptureSettings().developerMode)
        val name = "dev-${System.nanoTime()}"
        PrefsSettingsStore(context, name).save(CaptureSettings(developerMode = true))

        assertTrue(PrefsSettingsStore(context, name).load().developerMode)
    }

    @Test
    fun `notifications are left in the shade unless clearing is switched on`() {
        assertFalse(CaptureSettings().clearAfterForwarding)
    }

    @Test
    fun `the clear-after-forwarding choice survives a restart`() {
        val name = "clear-${System.nanoTime()}"
        PrefsSettingsStore(context, name).save(CaptureSettings(clearAfterForwarding = true))

        assertTrue(PrefsSettingsStore(context, name).load().clearAfterForwarding)
    }
}
