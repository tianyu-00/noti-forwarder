package com.notiforwarder.sender

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request

private val GITHUB_HOSTS = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")

/** Only GitHub, only over https. A download is also checked for size and, when published, checksum. */
private fun githubOnly(url: HttpUrl) = url.isHttps && url.host in GITHUB_HOSTS

/**
 * Downloads a release APK into [dir], checks it, and keeps it only if it is intact. Redirects are followed
 * (GitHub serves files from another host), but every hop must be an allowed host. Blocking.
 * Android itself still refuses an app signed by a different key, whatever is downloaded here.
 */
class ApkDownloader(
    private val dir: File,
    http: OkHttpClient = defaultHttpClient(),
    private val hostAllowed: (HttpUrl) -> Boolean = ::githubOnly,
) : ApkFetcher {
    private val client = http.newBuilder()
        .followRedirects(true)
        .followSslRedirects(true)
        .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .addNetworkInterceptor(Interceptor { chain ->
            if (!hostAllowed(chain.request().url)) throw IOException("Blocked a download from an unexpected address.")
            chain.proceed(chain.request())
        })
        .build()

    override fun download(info: ReleaseInfo, onProgress: (Int) -> Unit): DownloadOutcome {
        val url = info.apkUrl.toHttpUrlOrNull()
        if (url == null || !hostAllowed(url)) return DownloadOutcome.Failed("The update is not on GitHub, so it was not downloaded.")
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() } // earlier downloads are not needed any more
        val part = File(dir, "update.apk.part")
        return try {
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (response.code != 200) return failed(part, "The download failed (${response.code}).")
                val digest = MessageDigest.getInstance("SHA-256")
                var received = 0L
                var last = -1
                response.body.byteStream().use { input ->
                    part.outputStream().use { out ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            out.write(buffer, 0, n)
                            digest.update(buffer, 0, n)
                            received += n
                            val percent = if (info.sizeBytes > 0) (received * 100 / info.sizeBytes).toInt().coerceIn(0, 100) else 0
                            if (percent != last) {
                                last = percent
                                onProgress(percent)
                            }
                        }
                    }
                }
                if (received != info.sizeBytes) return failed(part, "The download was incomplete.")
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (info.sha256 != null && info.sha256 != actual) return failed(part, "The file did not match its checksum.")
                if (last != 100) onProgress(100)
                val done = File(dir, "notiforwarder-${info.version}.apk")
                if (!part.renameTo(done)) return failed(part, "Could not save the download.")
                DownloadOutcome.Done(done)
            }
        } catch (e: IOException) {
            failed(part, "The download stopped. Check your connection.")
        }
    }

    private fun failed(part: File, message: String): DownloadOutcome.Failed {
        part.delete()
        return DownloadOutcome.Failed(message)
    }
}
