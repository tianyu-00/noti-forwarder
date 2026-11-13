package com.notiforwarder.sender

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class PackageLabelsTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    private fun install(pkg: String, label: String?) {
        val info = PackageInfo().apply {
            packageName = pkg
            applicationInfo = ApplicationInfo().apply {
                packageName = pkg
                nonLocalizedLabel = label
            }
        }
        shadowOf(context.packageManager).installPackage(info)
    }

    @Test
    fun `gives the name an installed app shows to the user`() {
        install("com.google.android.gm", "Gmail")

        assertEquals("Gmail", PackageLabels(context.packageManager).labelFor("com.google.android.gm"))
    }

    @Test
    fun `is null for an app that is not installed any more`() {
        assertNull(PackageLabels(context.packageManager).labelFor("com.gone.app"))
    }

    @Test
    fun `is null when the name is just the package name again`() {
        install("com.plain.app", "com.plain.app")

        assertNull(PackageLabels(context.packageManager).labelFor("com.plain.app"))
    }
}
