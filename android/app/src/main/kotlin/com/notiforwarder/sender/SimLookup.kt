package com.notiforwarder.sender

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat

/**
 * The SIMs in the phone. Android only lists them to an app that may read the phone state, so
 * without that permission this answers null ("cannot tell"). Framework code, checked on a phone.
 */
class SimLookup(private val context: Context) {
    fun hasPermission() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    fun activeSims(): List<SimOption>? {
        if (!hasPermission()) return null
        val manager = context.getSystemService(SubscriptionManager::class.java) ?: return null
        return try {
            manager.activeSubscriptionInfoList.orEmpty()
                .sortedBy { it.simSlotIndex }
                .map { info ->
                    val name = info.carrierName?.toString()?.takeIf { it.isNotBlank() } ?: info.displayName?.toString().orEmpty()
                    SimOption(info.subscriptionId, "SIM ${info.simSlotIndex + 1} · $name".trimEnd(' ', '·'))
                }
        } catch (e: SecurityException) {
            null
        }
    }
}
