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

fun planFlushSoon(existing: List<WorkPhase>): FlushPlan = when {
    WorkPhase.Waiting in existing -> FlushPlan.Nothing
    WorkPhase.Running in existing -> FlushPlan.FollowUp
    else -> FlushPlan.Start
}
