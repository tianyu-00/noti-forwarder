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
class ReceiverPrefsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private fun name() = "receiver-${System.nanoTime()}"

    @Test
    fun `alerts start on for everything, with no apps turned off`() {
        assertEquals(ReceiverSettings(), PrefsReceiverSettingsStore(context, name()).load())
    }

    @Test
    fun `the user's alert rules are kept`() {
        val n = name()
        val rules = ReceiverSettings(
            enabled = false, mode = AlertMode.CodesOnly, types = setOf("sms"), blockedApps = setOf("com.game", "com.news"),
            quietAlerts = false, batteryAlerts = false,
        )

        PrefsReceiverSettingsStore(context, n).save(rules)

        assertEquals(rules, PrefsReceiverSettingsStore(context, n).load())
    }

    @Test
    fun `the first sync after pairing is remembered, and forgotten when the phone is unpaired`() {
        val n = name()
        val state = PrefsSyncState(context, n)
        assertFalse(state.seeded)

        state.seeded = true
        assertTrue(PrefsSyncState(context, n).seeded)

        state.reset()
        assertFalse(PrefsSyncState(context, n).seeded)
    }
}
