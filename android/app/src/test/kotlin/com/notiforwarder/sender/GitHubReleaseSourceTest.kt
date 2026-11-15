package com.notiforwarder.sender

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GitHubReleaseSourceTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.close()
    }

    private fun source() = GitHubReleaseSource(
        repo = "owner/repo",
        baseUrl = server.url("/").toString().trimEnd('/'),
        http = defaultHttpClient(),
    )

    private val body = """{"tag_name":"v0.1.66","draft":false,"prerelease":false,"assets":[{"name":"a.apk","size":5,"browser_download_url":"https://github.com/o/r/a.apk"}]}"""

    @Test
    fun `asks GitHub for the latest release of the repo and returns it`() {
        server.enqueue(MockResponse.Builder().code(200).body(body).build())

        val outcome = source().latest()

        assertEquals("0.1.66", (outcome as ReleaseOutcome.Found).info.version)
        val request = server.takeRequest()
        assertEquals("/repos/owner/repo/releases/latest", request.url.encodedPath)
        assertEquals("application/vnd.github+json", request.headers["Accept"])
    }

    @Test
    fun `a release without an APK is reported as nothing to install`() {
        server.enqueue(MockResponse.Builder().code(200).body("""{"tag_name":"v1.0.0","assets":[]}""").build())

        assertEquals(ReleaseOutcome.NoApk, source().latest())
    }

    @Test
    fun `no release yet, a rate limit and a server error are failures with a reason`() {
        for (code in listOf(404, 403, 500)) {
            server.enqueue(MockResponse.Builder().code(code).build())
            assertTrue("code $code", source().latest() is ReleaseOutcome.Failed)
        }
    }

    @Test
    fun `an unreachable GitHub is a failure, not a crash`() {
        server.close()

        assertTrue(source().latest() is ReleaseOutcome.Failed)
    }
}
