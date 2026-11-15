package com.notiforwarder.sender

data class SyncPlan(val toAdd: List<ReceivedMessage>, val toDelete: List<String>)

/**
 * The phone keeps a copy of the newest messages. This works out how to bring it in line with the server's newest
 * page: add what is new, and drop what was deleted on the dashboard.
 *
 * If the server's page is not full, it is the whole list, so anything else on the phone is gone. If it is full, only
 * messages inside its time range can be judged: older ones may simply be beyond the page, so they are left alone.
 */
object SyncPlanner {
    fun plan(local: List<LocalRef>, server: List<ReceivedMessage>, window: Int): SyncPlan {
        val localIds = local.map { it.id }.toSet()
        val serverIds = server.map { it.id }.toSet()
        val complete = server.size < window
        val oldest = server.lastOrNull() // the server's page is newest first
        val toDelete = local.filter { ref ->
            ref.id !in serverIds && (complete || (oldest != null && isNotOlder(ref, oldest)))
        }.map { it.id }
        return SyncPlan(toAdd = server.filter { it.id !in localIds }, toDelete = toDelete)
    }

    private fun isNotOlder(ref: LocalRef, oldest: ReceivedMessage): Boolean =
        compareValuesBy(ref, LocalRef(oldest.id, oldest.receivedAt), { it.receivedAt }, { it.id }) >= 0
}
