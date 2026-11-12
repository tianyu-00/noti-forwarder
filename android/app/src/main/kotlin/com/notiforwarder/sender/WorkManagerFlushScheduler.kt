package com.notiforwarder.sender

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Runs one flush. WorkManager only starts it while the phone has a network connection. */
class FlushWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        (applicationContext as NotiApp).flushRunner.run()
        return Result.success()
    }
}

/**
 * Schedules flushes with WorkManager, which survives app restarts and reboots and waits for
 * connectivity. The decisions about when to schedule live in the tested planFlushSoon().
 */
class WorkManagerFlushScheduler(context: Context) : FlushScheduler {
    private val workManager = WorkManager.getInstance(context)

    // Reading job state blocks, and callers may be on the main thread, so hop to a worker thread.
    private val executor = Executors.newSingleThreadExecutor()

    override fun flushSoon() {
        executor.execute {
            val phases = workManager.getWorkInfosForUniqueWork(NAME).get().map { it.state.toPhase() }
            when (planFlushSoon(phases)) {
                FlushPlan.Start -> enqueue(0, ExistingWorkPolicy.REPLACE)
                FlushPlan.FollowUp -> enqueue(0, ExistingWorkPolicy.APPEND_OR_REPLACE)
                FlushPlan.Nothing -> Unit
            }
        }
    }

    override fun flushAfter(delayMillis: Long) {
        // Called from inside a running flush: chain the retry after it.
        enqueue(delayMillis, ExistingWorkPolicy.APPEND_OR_REPLACE)
    }

    private fun enqueue(delayMillis: Long, policy: ExistingWorkPolicy) {
        val request = OneTimeWorkRequest.Builder(FlushWorker::class.java)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .build()
        workManager.enqueueUniqueWork(NAME, policy, request)
    }

    private fun WorkInfo.State.toPhase() = when (this) {
        WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> WorkPhase.Waiting
        WorkInfo.State.RUNNING -> WorkPhase.Running
        else -> WorkPhase.Finished
    }

    private companion object {
        const val NAME = "flush"
    }
}
