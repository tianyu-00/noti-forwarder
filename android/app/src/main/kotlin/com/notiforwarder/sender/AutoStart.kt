package com.notiforwarder.sender

/**
 * What to tell the user about letting this app start by itself. Android has no standard page for
 * it and every maker puts the switch somewhere else (OnePlus hides its own list from other apps),
 * so the app opens its own info page and says what to look for from there.
 */
fun autoStartHelp(): String =
    "The steps differ on every phone. In this app's settings, look for Auto-launch or " +
        "Background activity and allow them"
