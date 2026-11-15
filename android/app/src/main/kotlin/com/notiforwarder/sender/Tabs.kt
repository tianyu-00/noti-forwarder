package com.notiforwarder.sender

/** The screens in the bottom bar, in the order they appear. */
enum class Tab(val label: String) {
    Status("Status"),
    Forward("Forward"),
    Activity("Activity"),
    Alerts("Alerts"),
    Settings("Settings"),
}

/** An unpaired phone only has the pairing screen, so there is nothing to switch between. */
fun visibleTabs(paired: Boolean, role: AppRole = AppRole.Sender): List<Tab> = when {
    !paired -> emptyList()
    role == AppRole.Receiver -> listOf(Tab.Status, Tab.Alerts, Tab.Settings)
    else -> listOf(Tab.Status, Tab.Forward, Tab.Activity, Tab.Settings)
}

/** The tab to show: the chosen one while paired, Status again once the phone has been unpaired. */
fun currentTab(chosen: Tab, paired: Boolean): Tab = if (paired) chosen else Tab.Status
