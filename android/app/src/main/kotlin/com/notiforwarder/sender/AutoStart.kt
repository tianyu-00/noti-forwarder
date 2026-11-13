package com.notiforwarder.sender

/**
 * What to tell the user about letting this app start by itself. Android has no standard page for
 * it, and OnePlus/Oppo/Realme keep theirs behind a permission and an unexported screen that no
 * other app can open. The one page we can open is this app's own info page, and on those phones
 * the switch is two taps from there.
 */
fun autoStartHelp(manufacturer: String): String = when (manufacturer.lowercase()) {
    "oneplus", "oppo", "realme" ->
        "Tap Battery usage, then switch on Allow auto-launch and Allow background activity"
    else -> "Allow this app to run in the background and to start by itself in your phone's settings"
}
