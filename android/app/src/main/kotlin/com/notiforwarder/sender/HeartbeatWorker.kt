package com.notiforwarder.sender

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Checks in with the server about every 15 minutes (Android's minimum for periodic work), so the
 * dashboard can tell an idle phone from a dead one. A miss is simply tried again next time.
 */
class HeartbeatWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        (applicationContext as NotiApp).heartbeat.send()
        return Result.success()
    }

    companion object {
        private const val NAME = "heartbeat"

        /** Safe to call on every app start: KEEP leaves an already scheduled job alone. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequest.Builder(HeartbeatWorker::class.java, 15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
