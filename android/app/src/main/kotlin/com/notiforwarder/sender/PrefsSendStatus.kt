package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit

class PrefsSendStatus(context: Context) : SendStatus {
    private val prefs = context.getSharedPreferences("send_status", Context.MODE_PRIVATE)

    override fun lastSuccessAt(): Long? =
        if (prefs.contains(KEY)) prefs.getLong(KEY, 0) else null

    override fun recordSuccess(atMillis: Long) = prefs.edit { putLong(KEY, atMillis) }

    private companion object {
        const val KEY = "lastSuccessAt"
    }
}
