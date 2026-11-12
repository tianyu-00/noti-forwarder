package com.notiforwarder.sender

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Keeps the device token encrypted with a key held in the Android Keystore. */
class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "credentials",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun load(): Credentials? {
        val server = prefs.getString("serverUrl", null) ?: return null
        val deviceId = prefs.getString("deviceId", null) ?: return null
        val token = prefs.getString("token", null) ?: return null
        return Credentials(server, deviceId, token)
    }

    override fun save(credentials: Credentials) = prefs.edit {
        putString("serverUrl", credentials.serverUrl)
        putString("deviceId", credentials.deviceId)
        putString("token", credentials.token)
    }

    override fun clear() = prefs.edit { clear() }
}
