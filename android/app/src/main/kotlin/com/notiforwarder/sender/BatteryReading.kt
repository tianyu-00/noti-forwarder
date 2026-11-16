package com.notiforwarder.sender

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/** How full the battery is (0 to 100) and whether the phone is plugged in. */
data class BatteryReading(val percent: Int, val charging: Boolean) {
    companion object {
        /** From what Android reports: [level] out of [scale], and the [status] code. Null if it gave nothing usable. */
        fun from(level: Int, scale: Int, status: Int): BatteryReading? {
            if (level < 0 || scale <= 0) return null
            val percent = Math.round(level * 100f / scale).coerceIn(0, 100)
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
            return BatteryReading(percent, charging)
        }
    }
}

/** Reads the battery from Android's sticky "battery changed" news, which needs no permission. Framework code. */
class AndroidBatteryReader(private val context: Context) {
    fun read(): BatteryReading? {
        val intent: Intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        return BatteryReading.from(
            level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
            scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
            status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1),
        )
    }
}
