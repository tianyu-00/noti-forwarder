package com.notiforwarder.sender

import org.junit.Assert.assertTrue
import org.junit.Test

class InstallFailureTest {
    // Android's PackageInstaller status codes: 1 failure, 2 blocked, 3 aborted, 4 invalid, 5 conflict, 6 storage, 7 incompatible.

    @Test
    fun `an app signed with a different key says to uninstall once, since that is the usual cause`() {
        val message = installFailureMessage(status = 7, raw = "INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match")

        assertTrue(message, message.contains("signed", ignoreCase = true))
        assertTrue(message, message.contains("uninstall", ignoreCase = true))
    }

    @Test
    fun `a signature mismatch is recognised from the text too, whatever the code`() {
        assertTrue(installFailureMessage(status = 1, raw = "INSTALL_FAILED_UPDATE_INCOMPATIBLE").contains("uninstall", ignoreCase = true))
    }

    @Test
    fun `not enough space says so`() {
        assertTrue(installFailureMessage(status = 6, raw = null).contains("space", ignoreCase = true))
    }

    @Test
    fun `cancelling is not an error to alarm the user with`() {
        assertTrue(installFailureMessage(status = 3, raw = null).contains("cancel", ignoreCase = true))
        assertTrue(installFailureMessage(status = 2, raw = null).contains("blocked", ignoreCase = true))
    }

    @Test
    fun `anything else gets a generic message with Android's own reason when there is one`() {
        assertTrue(installFailureMessage(status = 1, raw = "INSTALL_FAILED_OLDER_SDK").contains("INSTALL_FAILED_OLDER_SDK"))
        assertTrue(installFailureMessage(status = 99, raw = null).isNotBlank())
    }
}
