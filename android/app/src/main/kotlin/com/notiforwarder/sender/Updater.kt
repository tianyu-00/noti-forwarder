package com.notiforwarder.sender

import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** A published app release: its version, where its APK is, and how to check the download. */
data class ReleaseInfo(val version: String, val apkUrl: String, val sizeBytes: Long, val sha256: String?)

/** Reads GitHub's "latest release" answer. Null when there is nothing installable (no APK, a draft, bad text). */
fun parseLatestRelease(json: String): ReleaseInfo? {
    val release = try {
        Json.parseToJsonElement(json) as? JsonObject
    } catch (e: Exception) {
        null
    } ?: return null
    if (release["draft"]?.jsonPrimitive?.booleanOrNull == true) return null
    if (release["prerelease"]?.jsonPrimitive?.booleanOrNull == true) return null
    val tag = release["tag_name"]?.jsonPrimitive?.contentOrNull ?: return null
    val assets = (release["assets"] as? JsonArray) ?: return null
    val apk = assets.map { it.jsonObject }.firstOrNull {
        it["name"]?.jsonPrimitive?.contentOrNull?.endsWith(".apk", ignoreCase = true) == true
    } ?: return null
    val url = apk["browser_download_url"]?.jsonPrimitive?.contentOrNull ?: return null
    val size = apk["size"]?.jsonPrimitive?.longOrNull ?: return null
    val sha = apk["digest"]?.jsonPrimitive?.contentOrNull?.removePrefix("sha256:")?.lowercase()
    return ReleaseInfo(AppVersion.clean(tag), url, size, sha)
}

sealed interface ReleaseOutcome {
    data class Found(val info: ReleaseInfo) : ReleaseOutcome
    data object NoApk : ReleaseOutcome
    data class Failed(val reason: String) : ReleaseOutcome
}

fun interface ReleaseSource {
    fun latest(): ReleaseOutcome
}

sealed interface DownloadOutcome {
    data class Done(val file: File) : DownloadOutcome
    data class Failed(val message: String) : DownloadOutcome
}

interface ApkFetcher {
    fun download(info: ReleaseInfo, onProgress: (Int) -> Unit = {}): DownloadOutcome
}

interface ApkInstaller {
    /** False until the user has allowed this app to install apps in Android's settings. */
    fun canInstall(): Boolean

    /** Hands the file to Android's installer, which asks the user to confirm. */
    fun install(file: File)
}

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data class UpToDate(val version: String) : UpdateState
    data class Available(val info: ReleaseInfo) : UpdateState
    data class Downloading(val info: ReleaseInfo, val percent: Int) : UpdateState
    /** Downloaded and checked, but Android has not yet allowed this app to install apps. */
    data class NeedsPermission(val file: File) : UpdateState
    data object Installing : UpdateState
    data class Failed(val message: String) : UpdateState
}

/**
 * Check for a newer release, download it and hand it to Android to install. Blocking: call the methods
 * off the main thread and watch [state] from the screen.
 */
class Updater(
    private val source: ReleaseSource,
    private val downloader: ApkFetcher,
    private val installer: ApkInstaller,
    installedVersion: String,
) {
    private val installed = AppVersion.clean(installedVersion)
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state

    fun check() {
        _state.value = UpdateState.Checking
        _state.value = when (val outcome = source.latest()) {
            is ReleaseOutcome.Found ->
                if (AppVersion.isNewer(outcome.info.version, installed)) UpdateState.Available(outcome.info)
                else UpdateState.UpToDate(installed)
            ReleaseOutcome.NoApk -> UpdateState.Failed("The latest release has no app file.")
            is ReleaseOutcome.Failed -> UpdateState.Failed(outcome.reason)
        }
    }

    fun downloadAndInstall() {
        val offered = (_state.value as? UpdateState.Available)?.info ?: return
        _state.value = UpdateState.Downloading(offered, 0)
        when (val result = downloader.download(offered) { _state.value = UpdateState.Downloading(offered, it) }) {
            is DownloadOutcome.Failed -> _state.value = UpdateState.Failed(result.message)
            is DownloadOutcome.Done -> start(result.file)
        }
    }

    /** After the user allowed installing from this app: install the file that is already downloaded. */
    fun continueInstall() {
        val waiting = _state.value as? UpdateState.NeedsPermission ?: return
        if (installer.canInstall()) start(waiting.file)
    }

    private fun start(file: File) {
        if (!installer.canInstall()) {
            _state.value = UpdateState.NeedsPermission(file)
            return
        }
        _state.value = try {
            installer.install(file)
            UpdateState.Installing
        } catch (e: Exception) {
            UpdateState.Failed("Could not start the installer.")
        }
    }
}
