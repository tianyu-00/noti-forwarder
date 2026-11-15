package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVersionTest {
    @Test
    fun `a higher number is newer, compared as numbers and not as text`() {
        assertTrue(AppVersion.isNewer(latest = "0.1.66", installed = "0.1.9"))
        assertTrue(AppVersion.isNewer(latest = "0.2.0", installed = "0.1.99"))
        assertTrue(AppVersion.isNewer(latest = "1.0.0", installed = "0.9.9"))
    }

    @Test
    fun `the same or an older version is not newer`() {
        assertFalse(AppVersion.isNewer(latest = "0.1.66", installed = "0.1.66"))
        assertFalse(AppVersion.isNewer(latest = "0.1.9", installed = "0.1.66"))
    }

    @Test
    fun `a leading v from a release tag is ignored`() {
        assertTrue(AppVersion.isNewer(latest = "v0.1.66", installed = "0.1.65"))
        assertEquals("0.1.66", AppVersion.clean("v0.1.66"))
    }

    @Test
    fun `a local dev build is older than any release of the same number or higher`() {
        assertTrue(AppVersion.isNewer(latest = "0.1.66", installed = "0.1.0-dev"))
        assertTrue(AppVersion.isNewer(latest = "0.1.0", installed = "0.1.0-dev"))
    }

    @Test
    fun `text that is not a version is never newer, so a bad tag cannot trigger an update`() {
        assertFalse(AppVersion.isNewer(latest = "nightly", installed = "0.1.0"))
        assertFalse(AppVersion.isNewer(latest = "", installed = "0.1.0"))
    }
}
