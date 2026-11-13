package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class DescribeTimeTest {
    private val now = 10_000_000_000L
    private val minute = 60_000L
    private val hour = 60 * minute

    @Test
    fun `says never when nothing has been sent`() {
        assertEquals("never", describeAgo(null, now))
    }

    @Test
    fun `describes recent and older sends in plain words`() {
        assertEquals("just now", describeAgo(now - 20_000, now))
        assertEquals("1 minute ago", describeAgo(now - minute, now))
        assertEquals("5 minutes ago", describeAgo(now - 5 * minute, now))
        assertEquals("1 hour ago", describeAgo(now - hour, now))
        assertEquals("3 hours ago", describeAgo(now - 3 * hour, now))
        assertEquals("2 days ago", describeAgo(now - 48 * hour, now))
    }

    @Test
    fun `a clock that is slightly behind still reads as just now`() {
        assertEquals("just now", describeAgo(now + 5_000, now))
    }
}

class DescribeTimeShortTest {
    private val now = 10_000_000_000L
    private val minute = 60_000L
    private val hour = 60 * minute

    @Test
    fun `is short enough for a small tile`() {
        assertEquals("never", describeAgoShort(null, now))
        assertEquals("just now", describeAgoShort(now - 20_000, now))
        assertEquals("1 min ago", describeAgoShort(now - minute, now))
        assertEquals("24 min ago", describeAgoShort(now - 24 * minute, now))
        assertEquals("3 h ago", describeAgoShort(now - 3 * hour, now))
        assertEquals("2 d ago", describeAgoShort(now - 48 * hour, now))
    }
}
