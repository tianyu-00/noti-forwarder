package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectTest {
    @Test
    fun `the project link is the GitHub page of the same repository the updates come from`() {
        assertEquals("https://github.com/$PROJECT_REPO", PROJECT_URL)
    }

    @Test
    fun `the repository is written as owner and name`() {
        assertTrue(PROJECT_REPO.matches(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")))
    }
}
