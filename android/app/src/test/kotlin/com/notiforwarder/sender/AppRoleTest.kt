package com.notiforwarder.sender

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AppRoleTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `a new install has no role yet, so the app asks`() {
        assertNull(effectiveRole(stored = null, paired = false))
    }

    @Test
    fun `a phone that was paired before roles existed is a sender, with no question asked`() {
        assertEquals(AppRole.Sender, effectiveRole(stored = null, paired = true))
    }

    @Test
    fun `a chosen role wins, paired or not`() {
        assertEquals(AppRole.Receiver, effectiveRole(AppRole.Receiver, paired = false))
        assertEquals(AppRole.Receiver, effectiveRole(AppRole.Receiver, paired = true))
        assertEquals(AppRole.Sender, effectiveRole(AppRole.Sender, paired = false))
    }

    @Test
    fun `the chosen role is kept, and can be cleared to ask again`() {
        val name = "role-${System.nanoTime()}"
        val store = PrefsRoleStore(context, name)
        assertNull(store.load())

        store.save(AppRole.Receiver)
        assertEquals(AppRole.Receiver, PrefsRoleStore(context, name).load())

        store.clear()
        assertNull(PrefsRoleStore(context, name).load())
    }

    @Test
    fun `an unknown saved value is treated as no role, not a crash`() {
        val name = "role-${System.nanoTime()}"
        context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().putString("role", "wizard").commit()

        assertNull(PrefsRoleStore(context, name).load())
    }
}
