package com.notiforwarder.sender

/** What the phone's connection to the server is doing right now. */
enum class ConnectionState { Stopped, Connecting, Connected, Reconnecting }

data class ConnectionLabel(val text: String, val good: Boolean)

/** The words shown on the connection card. */
fun describeConnection(state: ConnectionState): ConnectionLabel = when (state) {
    ConnectionState.Connected -> ConnectionLabel("Connected to the server", good = true)
    ConnectionState.Connecting -> ConnectionLabel("Connecting…", good = false)
    ConnectionState.Reconnecting -> ConnectionLabel("Reconnecting…", good = false)
    ConnectionState.Stopped -> ConnectionLabel("Not connected", good = false)
}

/** The big word on the status card. */
fun connectionHeadline(state: ConnectionState): String = when (state) {
    ConnectionState.Connected -> "Connected"
    ConnectionState.Connecting -> "Connecting…"
    ConnectionState.Reconnecting -> "Reconnecting…"
    ConnectionState.Stopped -> "Not connected"
}

/** "https://notify.example.com/" -> "notify.example.com", for "Sending to …". */
fun serverName(serverUrl: String): String =
    if ("://" in serverUrl) serverUrl.substringAfter("://").trimEnd('/') else serverUrl
