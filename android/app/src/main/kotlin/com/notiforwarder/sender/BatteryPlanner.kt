package com.notiforwarder.sender

/** Wording and rules for the "a sender phone's battery is low" notice. Pure, so it is tested on the JVM. */
object BatteryPlanner {
    /** The server alerts at this level (15% or less while not charging); the list marks the same phones. */
    private const val LOW_AT = 15

    /** One notice per phone, apart from its quiet notice. */
    fun keyFor(deviceId: String) = "battery:$deviceId"

    fun low(deviceId: String, deviceName: String?, percent: Int, settings: ReceiverSettings): StatusPlan? {
        if (!settings.enabled || !settings.batteryAlerts) return null
        return StatusPlan(
            keyFor(deviceId),
            "${deviceName ?: "Phone"} battery is low",
            "$percent% left and it is not charging. Plug it in so it keeps forwarding.",
        )
    }

    fun isLow(battery: BatteryReading) = battery.percent <= LOW_AT && !battery.charging

    fun describe(battery: BatteryReading) = "${battery.percent}%" + if (battery.charging) ", charging" else ""
}
