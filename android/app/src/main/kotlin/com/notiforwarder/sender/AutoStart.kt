package com.notiforwarder.sender

/**
 * What to tell the user about letting this app start by itself. Android has no standard page for
 * it and every maker puts the switch somewhere else (on some phones it is not even in the app's
 * own settings; OnePlus hides its list from other apps), so this says what to turn on, not where.
 */
fun autoStartHelp(): String =
    "Turn on auto-launch and allow background activity for this app. The steps differ on every phone"
