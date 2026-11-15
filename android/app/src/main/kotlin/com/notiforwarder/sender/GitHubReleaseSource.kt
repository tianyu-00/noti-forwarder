package com.notiforwarder.sender

import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.Request

/** Asks GitHub for the newest release of [repo] ("owner/name"). Public repos need no login. Blocking. */
class GitHubReleaseSource(
    private val repo: String,
    private val baseUrl: String = "https://api.github.com",
    private val http: OkHttpClient = defaultHttpClient(),
) : ReleaseSource {
    override fun latest(): ReleaseOutcome {
        val request = Request.Builder()
            .url("$baseUrl/repos/$repo/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                when (response.code) {
                    200 -> parseLatestRelease(response.body.string())
                        ?.let { ReleaseOutcome.Found(it) } ?: ReleaseOutcome.NoApk
                    404 -> ReleaseOutcome.Failed("No release has been published yet.")
                    403, 429 -> ReleaseOutcome.Failed("GitHub is limiting requests. Try again in a while.")
                    else -> ReleaseOutcome.Failed("GitHub answered ${response.code}.")
                }
            }
        } catch (e: IOException) {
            ReleaseOutcome.Failed("Could not reach GitHub.")
        }
    }
}
