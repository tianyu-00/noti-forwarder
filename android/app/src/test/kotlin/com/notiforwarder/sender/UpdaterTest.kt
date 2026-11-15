package com.notiforwarder.sender

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdaterTest {
    private val info = ReleaseInfo("0.1.66", "https://github.com/o/r/a.apk", 100, null)
    private val file = File("/tmp/fake.apk")

    private class FakeSource(var outcome: ReleaseOutcome) : ReleaseSource {
        override fun latest() = outcome
    }

    private class FakeDownloader(var outcome: DownloadOutcome, val steps: List<Int> = listOf(10, 100)) : ApkFetcher {
        var calls = 0
        override fun download(info: ReleaseInfo, onProgress: (Int) -> Unit): DownloadOutcome {
            calls++
            steps.forEach(onProgress)
            return outcome
        }
    }

    private class FakeInstaller(var allowed: Boolean = true) : ApkInstaller {
        val installed = mutableListOf<File>()
        override fun canInstall() = allowed
        override fun install(file: File) {
            installed += file
        }
    }

    private val source = FakeSource(ReleaseOutcome.Found(info))
    private val downloader = FakeDownloader(DownloadOutcome.Done(file))
    private val installer = FakeInstaller()
    private fun updater(installed: String = "0.1.65") = Updater(source, downloader, installer, installed)

    @Test
    fun `starts idle`() {
        assertEquals(UpdateState.Idle, updater().state.value)
    }

    @Test
    fun `a newer release is offered`() {
        val u = updater("0.1.65")

        u.check()

        assertEquals(UpdateState.Available(info), u.state.value)
    }

    @Test
    fun `the same version means up to date`() {
        val u = updater("0.1.66")

        u.check()

        assertEquals(UpdateState.UpToDate("0.1.66"), u.state.value)
    }

    @Test
    fun `a release with no APK or an unreachable GitHub is a clear failure`() {
        val u = updater()
        source.outcome = ReleaseOutcome.NoApk
        u.check()
        assertTrue(u.state.value is UpdateState.Failed)

        source.outcome = ReleaseOutcome.Failed("offline")
        u.check()
        assertEquals(UpdateState.Failed("offline"), u.state.value)
    }

    @Test
    fun `checking again after a failure starts clean`() {
        val u = updater()
        source.outcome = ReleaseOutcome.Failed("offline")
        u.check()

        source.outcome = ReleaseOutcome.Found(info)
        u.check()

        assertEquals(UpdateState.Available(info), u.state.value)
    }

    @Test
    fun `nothing is downloaded until an update has been offered`() {
        val u = updater()

        u.downloadAndInstall()

        assertEquals(0, downloader.calls)
        assertEquals(UpdateState.Idle, u.state.value)
    }

    @Test
    fun `downloads the offered update and hands it to Android to install`() {
        val u = updater()
        u.check()

        u.downloadAndInstall()

        assertEquals(1, downloader.calls)
        assertEquals(listOf(file), installer.installed)
        assertEquals(UpdateState.Installing, u.state.value)
    }

    @Test
    fun `shows download progress while it downloads`() {
        lateinit var u: Updater
        val seen = mutableListOf<UpdateState>()
        val watcher = object : ApkFetcher {
            override fun download(info: ReleaseInfo, onProgress: (Int) -> Unit): DownloadOutcome {
                onProgress(40)
                seen += u.state.value
                return DownloadOutcome.Done(file)
            }
        }
        u = Updater(source, watcher, installer, "0.1.65")
        u.check()

        u.downloadAndInstall()

        assertEquals(listOf<UpdateState>(UpdateState.Downloading(info, 40)), seen)
    }

    @Test
    fun `a failed or damaged download is reported and nothing is installed`() {
        downloader.outcome = DownloadOutcome.Failed("The file did not match its checksum.")
        val u = updater()
        u.check()

        u.downloadAndInstall()

        assertEquals(UpdateState.Failed("The file did not match its checksum."), u.state.value)
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun `asks the user to allow installing from this app first, and keeps the file`() {
        installer.allowed = false
        val u = updater()
        u.check()

        u.downloadAndInstall()

        assertEquals(UpdateState.NeedsPermission(file), u.state.value)
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun `installs the kept file once the user has allowed it, without downloading again`() {
        installer.allowed = false
        val u = updater()
        u.check()
        u.downloadAndInstall()

        installer.allowed = true
        u.continueInstall()

        assertEquals(listOf(file), installer.installed)
        assertEquals(1, downloader.calls)
        assertEquals(UpdateState.Installing, u.state.value)
    }

    @Test
    fun `continuing does nothing while installing is still not allowed`() {
        installer.allowed = false
        val u = updater()
        u.check()
        u.downloadAndInstall()

        u.continueInstall()

        assertTrue(installer.installed.isEmpty())
        assertEquals(UpdateState.NeedsPermission(file), u.state.value)
    }
}
