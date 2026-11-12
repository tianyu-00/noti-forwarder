package com.notiforwarder.sender

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network

/**
 * Calls [onAvailable] whenever the phone gets a network (boot finishing, airplane mode off,
 * Wi-Fi to mobile data), so waiting work can start at once instead of at its next retry.
 * A thin wrapper over Android's own callback; the decisions live in the tested classes.
 */
class NetworkWatcher(context: Context, private val onAvailable: () -> Unit) {
    private val manager = context.getSystemService(ConnectivityManager::class.java)

    fun start() {
        manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = onAvailable()
        })
    }
}
