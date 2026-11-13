package com.notiforwarder.sender

/** One line of "Keep it running". It stays in the list once it is fine, so it shows a tick. */
data class RunningCheck(
    val kind: Kind,
    val text: String,
    val ok: Boolean,
    val detail: String? = null,
    /** The button label, or null when there is nothing to do. */
    val action: String? = null,
) {
    enum class Kind { NotificationAccess, Battery, PostNotifications, Sms, AutoStart }
}

/** Always the same rows in the same order, so a row does not appear and disappear as things change. */
fun runningChecks(settings: CaptureSettings, ready: Readiness): List<RunningCheck> = buildList {
    add(
        RunningCheck(
            RunningCheck.Kind.NotificationAccess,
            text = if (ready.accessGranted) "Notification access is on" else "Notification access is off",
            ok = ready.accessGranted,
            detail = if (ready.accessGranted) null else "Without it nothing can be forwarded",
            action = if (ready.accessGranted) null else "Open",
        ),
    )
    add(
        RunningCheck(
            RunningCheck.Kind.Battery,
            text = if (ready.batteryExempt) "Battery optimisation is off" else "Battery optimisation is on",
            ok = ready.batteryExempt,
            detail = if (ready.batteryExempt) null else "It may stop this app in the background",
            action = if (ready.batteryExempt) null else "Turn off",
        ),
    )
    add(
        RunningCheck(
            RunningCheck.Kind.PostNotifications,
            text = if (ready.notificationsAllowed) "Notifications are allowed" else "Allow notifications",
            ok = ready.notificationsAllowed,
            detail = if (ready.notificationsAllowed) {
                null
            } else {
                "Android needs it to show the \"running\" notice that keeps the app alive"
            },
            action = if (ready.notificationsAllowed) null else "Allow",
        ),
    )
    // Only matters while texts are being forwarded.
    if (settings.sendSms) {
        add(
            RunningCheck(
                RunningCheck.Kind.Sms,
                text = if (ready.smsAllowed) "Reading texts is allowed" else "Allow reading texts",
                ok = ready.smsAllowed,
                detail = if (ready.smsAllowed) null else "Texts can only be forwarded once you allow the SMS permission",
                action = if (ready.smsAllowed) null else "Allow",
            ),
        )
    }
    // Android cannot say whether auto-start is allowed, so this always asks the user to check.
    add(RunningCheck(RunningCheck.Kind.AutoStart, text = "Auto-start", ok = false, detail = autoStartHelp(), action = "Open"))
}
