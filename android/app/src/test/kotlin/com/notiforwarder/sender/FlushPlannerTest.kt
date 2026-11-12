package com.notiforwarder.sender

import com.notiforwarder.sender.FlushPlan.FollowUp
import com.notiforwarder.sender.FlushPlan.Nothing
import com.notiforwarder.sender.FlushPlan.Start
import com.notiforwarder.sender.WorkPhase.Finished
import com.notiforwarder.sender.WorkPhase.Running
import com.notiforwarder.sender.WorkPhase.Waiting
import org.junit.Assert.assertEquals
import org.junit.Test

class FlushPlannerTest {
    @Test
    fun `starts a flush when none is scheduled`() {
        assertEquals(Start, planFlushSoon(emptyList()))
        assertEquals(Start, planFlushSoon(listOf(Finished, Finished)))
    }

    @Test
    fun `leaves a waiting flush alone, so a backoff delay is not cut short by new notifications`() {
        assertEquals(Nothing, planFlushSoon(listOf(Waiting)))
        assertEquals(Nothing, planFlushSoon(listOf(Running, Waiting)))
    }

    @Test
    fun `queues a follow-up when a flush is running, so a message that arrives mid-flush is not missed`() {
        assertEquals(FollowUp, planFlushSoon(listOf(Running)))
        assertEquals(FollowUp, planFlushSoon(listOf(Finished, Running)))
    }
}
