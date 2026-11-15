package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Test

class BuildVariantTest {
    // A debug build from this PC has its own app id, so it installs next to the signed release app instead of
    // fighting it over the signing key. Each keeps its own pairing and settings. (The release id is set by
    // `applicationId` and must stay "com.notiforwarder.sender": phones update in place by that id.)
    @Test
    fun `a debug build installs as its own app, next to the release app`() {
        assertEquals("com.notiforwarder.sender.debug", BuildConfig.APPLICATION_ID)
    }

    @Test
    fun `the code still lives in the one package, whatever the app id`() {
        assertEquals("com.notiforwarder.sender", BuildVariantTest::class.java.packageName)
    }
}
