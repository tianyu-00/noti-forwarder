package com.notiforwarder.sender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReleaseParserTest {
    private fun release(assets: String, extra: String = "") =
        """{"tag_name":"v0.1.66","draft":false,"prerelease":false$extra,"assets":[$assets]}"""

    private val apk = """{"name":"notiforwarder-0.1.66.apk","size":30251008,"browser_download_url":"https://github.com/o/r/releases/download/v0.1.66/notiforwarder-0.1.66.apk"}"""

    @Test
    fun `reads the version and the APK from the latest release`() {
        val info = parseLatestRelease(release(apk))!!

        assertEquals("0.1.66", info.version)
        assertEquals("https://github.com/o/r/releases/download/v0.1.66/notiforwarder-0.1.66.apk", info.apkUrl)
        assertEquals(30251008L, info.sizeBytes)
        assertNull(info.sha256)
    }

    @Test
    fun `picks the APK among other files`() {
        val other = """{"name":"notes.txt","size":10,"browser_download_url":"https://github.com/o/r/notes.txt"}"""

        assertEquals("notiforwarder-0.1.66.apk", parseLatestRelease(release("$other,$apk"))!!.apkUrl.substringAfterLast('/'))
    }

    @Test
    fun `reads the checksum GitHub publishes for the file, when there is one`() {
        val withDigest = apk.dropLast(1) + ""","digest":"sha256:ABCDEF0123"}"""

        assertEquals("abcdef0123", parseLatestRelease(release(withDigest))!!.sha256)
    }

    @Test
    fun `a release with no APK is no update`() {
        assertNull(parseLatestRelease(release("")))
    }

    @Test
    fun `drafts and pre-releases are never offered`() {
        assertNull(parseLatestRelease(release(apk).replace("\"draft\":false", "\"draft\":true")))
        assertNull(parseLatestRelease(release(apk).replace("\"prerelease\":false", "\"prerelease\":true")))
    }

    @Test
    fun `unreadable text is no update, not a crash`() {
        assertNull(parseLatestRelease("not json"))
        assertNull(parseLatestRelease("""{"message":"Not Found"}"""))
    }
}
