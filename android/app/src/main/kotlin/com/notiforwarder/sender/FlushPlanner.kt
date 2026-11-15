package com.notiforwarder.sender

/** Simplified state of a scheduled flush job. */
enum class WorkPhase { Waiting, Running, Finished }

enum class FlushPlan {
    /** Schedule a flush now. */
    Start,

    /** A flush is running: schedule one to follow it, so a message that arrived mid-flush is sent. */
    FollowUp,

    /** A flush is already waiting (maybe out a backoff delay): leave it alone. */
    Nothing,
}

/**
 * Like [planFlushSoon], but a flush that is waiting out a retry delay is replaced, not respected. For when the
 * server is known to be reachable. A running flush is still never interrupted.
 */
fun planFlushNow(existing: List<WorkPhase>): FlushPlan =
    if (WorkPhase.Running in existing) FlushPlan.FollowUp else FlushPlan.Start

fun planFlushSoon(existing: List<WorkPhase>): FlushPlan = when {
    WorkPhase.Waiting in existing -> FlushPlan.Nothing
    WorkPhase.Running in existing -> FlushPlan.FollowUp
    else -> FlushPlan.Start
}
