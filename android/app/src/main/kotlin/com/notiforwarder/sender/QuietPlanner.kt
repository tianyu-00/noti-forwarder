package com.notiforwarder.sender

/** A notice about a sender phone (not a message): its key is how it is replaced or removed later. */
data class StatusPlan(val key: String, val title: String, val text: String)

/** Wording and rules for the "a sender phone has gone quiet / is back" notices. Pure, so it is tested on the JVM. */
object QuietPlanner {
    /** One notice per phone: "is back" takes the place of "has gone quiet". */
    fun keyFor(deviceId: String) = "quiet:$deviceId"

    fun quiet(deviceId: String, deviceName: String?, minutes: Int, settings: ReceiverSettings): StatusPlan? {
        if (!allowed(settings)) return null
        return StatusPlan(
            keyFor(deviceId),
            "${deviceName ?: "Phone"} has gone quiet",
            "No contact for ${duration(minutes)}. Check that the app is running and Notification access is on.",
        )
    }

    fun back(deviceId: String, deviceName: String?, settings: ReceiverSettings): StatusPlan? {
        if (!allowed(settings)) return null
        return StatusPlan(keyFor(deviceId), "${deviceName ?: "Phone"} is back", "It is checking in again.")
    }

    private fun allowed(settings: ReceiverSettings) = settings.enabled && settings.quietAlerts

    private fun duration(minutes: Int): String = when {
        minutes < 60 -> plural(minutes, "minute")
        minutes < 24 * 60 -> plural(minutes / 60, "hour")
        else -> plural(minutes / (24 * 60), "day")
    }

    private fun plural(n: Int, unit: String) = "$n $unit${if (n == 1) "" else "s"}"
}
