package com.notiforwarder.sender

import android.content.pm.PackageManager

/**
 * Asks Android for the name it shows for an app. Works for any installed app (the manifest holds
 * QUERY_ALL_PACKAGES, so Android 11+ package hiding does not apply). Thin on purpose: the logic
 * that uses it takes a plain function, so it is tested without a device.
 */
class PackageLabels(private val pm: PackageManager) {
    /** Null when the app is gone, or its name is only its package name. */
    fun labelFor(packageName: String): String? = try {
        pm.getApplicationInfo(packageName, 0).loadLabel(pm).toString().trim()
            .takeIf { it.isNotEmpty() && it != packageName }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}
