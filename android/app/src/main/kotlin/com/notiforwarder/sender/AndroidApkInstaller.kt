package com.notiforwarder.sender

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import java.io.File

/**
 * What to tell the user when Android refuses an install. [status] is PackageInstaller's code and [raw] its
 * own reason. A signature mismatch is by far the most likely cause for a sideloaded app, so it is spelled out.
 */
fun installFailureMessage(status: Int, raw: String?): String = when {
    status == 7 || raw?.contains("UPDATE_INCOMPATIBLE") == true ->
        "The new version is signed with a different key than the installed one, so Android refused it. " +
            "Uninstall the app once and install the new version by hand; later updates then work."
    status == 6 -> "There is not enough space on the phone to install the update."
    status == 3 -> "The installation was cancelled."
    status == 2 -> "Android blocked the installation. Check that this app may install other apps."
    raw != null -> "Android could not install the update ($raw)."
    else -> "Android could not install the update."
}

/**
 * Hands a downloaded APK to Android's package installer, which asks the user to confirm. Framework code,
 * checked on a phone. Android only accepts an update signed with the same key as the installed app.
 */
class AndroidApkInstaller(private val context: Context) : ApkInstaller {
    override fun canInstall() = context.packageManager.canRequestPackageInstalls()

    override fun install(file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            .apply { setAppPackageName(context.packageName) }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("update", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            // The system fills in the result, so the intent must be mutable.
            val result = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, InstallResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
            )
            session.commit(result.intentSender)
        }
    }
}

/** Android's answer to an install: show its confirmation screen, or say why it failed. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(context::startActivity)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // the app is replaced and restarted by Android
            else -> {
                val message = installFailureMessage(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
                (context.applicationContext as NotiApp).updater.installFailed(message) // shown on the update card
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        }
    }
}
