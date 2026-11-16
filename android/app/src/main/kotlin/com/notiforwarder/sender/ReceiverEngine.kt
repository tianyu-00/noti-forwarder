package com.notiforwarder.sender

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** News from the server about a sender phone: it stopped checking in (minutes quiet), or it is back. */
@kotlinx.serialization.Serializable
private data class QuietEvent(val deviceId: String, val deviceName: String? = null, val minutes: Int = 0)

sealed interface RecentOutcome {
    data class Messages(val messages: List<ReceivedMessage>) : RecentOutcome
    data object Unauthorized : RecentOutcome
    data class Failed(val reason: String) : RecentOutcome
}

enum class SyncResult { Ok, Offline, Unauthorized }

/** What the receiver needs from the server. A seam so the logic is tested without a network. */
interface ReceiverApi {
    fun recent(limit: Int): RecentOutcome
}

/** The phone's copy of the messages. */
interface ReceivedStore {
    fun refs(): List<LocalRef>
    fun insert(messages: List<ReceivedMessage>)
    fun delete(ids: List<String>)
    fun idsForDevice(deviceId: String): List<String>
    fun allIds(): List<String>
    fun contains(id: String): Boolean
}

/** Shows and removes notifications. Android code behind this. */
interface AlertSink {
    fun show(plan: AlertPlan)
    fun showStatus(plan: StatusPlan)
    fun cancel(keys: List<String>)
    fun cancelAll()
}

/** Whether the first sync after pairing has happened: the history it brings in is not announced as alerts. */
interface SyncState {
    var seeded: Boolean
}

/**
 * The receiver's brain: keeps the phone's copy of the messages in step with the dashboard, and shows an alert for
 * each new message. Plain Kotlin, so it is tested on the JVM with fakes. Blocking: call it off the main thread.
 */
class ReceiverEngine(
    private val api: ReceiverApi,
    private val store: ReceivedStore,
    private val alerts: AlertSink,
    private val settings: () -> ReceiverSettings,
    private val reader: MessageReader,
    private val state: SyncState,
    private val window: Int = 200,
    /** After a long absence, only this many of the newest messages become alerts. */
    private val maxAlertsPerSync: Int = 5,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Loads the server's newest messages and reconciles: add what is new, remove what was deleted. */
    @Synchronized
    fun sync(): SyncResult {
        val server = when (val outcome = api.recent(window)) {
            is RecentOutcome.Messages -> outcome.messages
            RecentOutcome.Unauthorized -> return SyncResult.Unauthorized
            is RecentOutcome.Failed -> return SyncResult.Offline
        }
        val plan = SyncPlanner.plan(store.refs(), server, window)
        if (plan.toDelete.isNotEmpty()) {
            store.delete(plan.toDelete)
            alerts.cancel(plan.toDelete)
        }
        store.insert(plan.toAdd)
        if (state.seeded) {
            // toAdd is newest first; alert for the newest few, oldest of them first.
            plan.toAdd.take(maxAlertsPerSync).reversed().forEach(::alertFor)
        } else {
            state.seeded = true // the history on first pairing arrives silently
        }
        return SyncResult.Ok
    }

    /** One event from the live stream. Unknown or damaged news is ignored. */
    @Synchronized
    fun onEvent(type: String, data: String) {
        when (type) {
            "message" -> {
                val message = parse<ReceivedMessage>(data) ?: return
                if (store.contains(message.id)) return
                store.insert(listOf(message))
                alertFor(message)
            }
            "messages_cleared", "device_deleted" -> {
                val deviceId = deviceIdOf(data) ?: return
                val ids = store.idsForDevice(deviceId)
                store.delete(ids)
                // An erased phone can no longer be quiet, so its notice goes too.
                alerts.cancel(if (type == "device_deleted") ids + QuietPlanner.keyFor(deviceId) else ids)
            }
            "device_quiet" -> {
                val e = parse<QuietEvent>(data) ?: return
                QuietPlanner.quiet(e.deviceId, e.deviceName, e.minutes, settings())?.let(alerts::showStatus)
            }
            "device_back" -> {
                val e = parse<QuietEvent>(data) ?: return
                val plan = QuietPlanner.back(e.deviceId, e.deviceName, settings())
                // With the notices switched off the old one still has to go, so it never lingers as a false alarm.
                if (plan != null) alerts.showStatus(plan) else alerts.cancel(listOf(QuietPlanner.keyFor(e.deviceId)))
            }
            "messages_cleared_all" -> {
                store.delete(store.allIds())
                alerts.cancelAll()
            }
            "messages_purged" -> sync()
        }
    }

    private fun alertFor(message: ReceivedMessage) {
        AlertPlanner.plan(message, reader.read(message), settings())?.let(alerts::show)
    }

    private inline fun <reified T> parse(text: String): T? = try {
        json.decodeFromString<T>(text)
    } catch (e: SerializationException) {
        null
    } catch (e: IllegalArgumentException) {
        null
    }

    private fun deviceIdOf(text: String): String? = try {
        (json.parseToJsonElement(text) as? JsonObject)?.get("deviceId")?.jsonPrimitive?.contentOrNull
    } catch (e: SerializationException) {
        null
    } catch (e: IllegalArgumentException) {
        null
    }
}
