package com.notiforwarder.sender

/** The screens in the bottom bar, in the order they appear. */
enum class Tab(val label: String) {
    Status("Status"),
    Forward("Forward"),
    Activity("Activity"),
    Settings("Settings"),
}

/** An unpaired phone only has the pairing screen, so there is nothing to switch between. */
fun visibleTabs(paired: Boolean): List<Tab> = if (paired) Tab.entries.toList() else emptyList()

/** The tab to show: the chosen one while paired, Status again once the phone has been unpaired. */
fun currentTab(chosen: Tab, paired: Boolean): Tab = if (paired) chosen else Tab.Status
