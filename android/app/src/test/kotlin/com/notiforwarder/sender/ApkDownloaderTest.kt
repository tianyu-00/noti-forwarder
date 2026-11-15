package com.notiforwarder.sender

import java.io.File
import java.security.MessageDigest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.Rule

class ApkDownloaderTest {
    @get:Rule val folder = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val bytes = ByteArray(50_000) { (it % 251).toByte() }

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.close()
    }

    private fun sha(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    // The real downloader only trusts GitHub's hosts over https; the tests allow the local test server.
    private fun downloader(dir: File = folder.newFolder()) =
        ApkDownloader(dir, defaultHttpClient().newBuilder().followRedirects(true).build(), hostAllowed = { true })

    private fun info(size: Long = bytes.size.toLong(), sha256: String? = sha(bytes), url: String = server.url("/a.apk").toString()) =
        ReleaseInfo("0.1.66", url, size, sha256)

    private fun serve(data: ByteArray = bytes) =
        server.enqueue(MockResponse.Builder().code(200).body(Buffer().write(data)).build())

    @Test
    fun `downloads the file and keeps it when size and checksum match`() {
        serve()
        val progress = mutableListOf<Int>()

        val outcome = downloader().download(info()) { progress += it }

        val file = (outcome as DownloadOutcome.Done).file
        assertEquals(bytes.size.toLong(), file.length())
        assertTrue(file.readBytes().contentEquals(bytes))
        assertEquals(100, progress.last())
        assertTrue(progress.zipWithNext().all { (a, b) -> a <= b })
    }

    @Test
    fun `a file of the wrong size is thrown away`() {
        serve()

        val outcome = downloader().download(info(size = bytes.size + 1L))

        assertTrue(outcome is DownloadOutcome.Failed)
    }

    @Test
    fun `a file with the wrong checksum is thrown away, and nothing is left behind`() {
        serve()
        val dir = folder.newFolder()

        val outcome = downloader(dir).download(info(sha256 = sha("other".toByteArray())))

        assertTrue(outcome is DownloadOutcome.Failed)
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun `without a published checksum the size alone is checked`() {
        serve()

        assertTrue(downloader().download(info(sha256 = null)) is DownloadOutcome.Done)
    }

    @Test
    fun `a server error is a failure`() {
        server.enqueue(MockResponse.Builder().code(404).build())

        assertTrue(downloader().download(info()) is DownloadOutcome.Failed)
    }

    @Test
    fun `only GitHub over https is trusted by default`() {
        val real = ApkDownloader(folder.newFolder(), defaultHttpClient())

        for (bad in listOf("http://github.com/a.apk", "https://evil.example.com/a.apk", "https://github.com.evil.com/a.apk", "file:///sdcard/a.apk")) {
            assertTrue(bad, real.download(info(url = bad)) is DownloadOutcome.Failed)
        }
        assertFalse(server.requestCount > 0)
    }

    @Test
    fun `old downloads are cleared before a new one starts`() {
        serve()
        val dir = folder.newFolder()
        File(dir, "old.apk").writeBytes(ByteArray(10))

        downloader(dir).download(info())

        assertFalse(File(dir, "old.apk").exists())
    }
}
