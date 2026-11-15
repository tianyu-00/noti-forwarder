package com.notiforwarder.sender

/** The receiver's local copy of the messages, in the app's database. Newest [keep] only. */
class RoomReceivedStore(private val dao: ReceivedDao, private val keep: Int = 500) : ReceivedStore {
    override fun refs() = dao.refs().map { LocalRef(it.id, it.receivedAt) }

    override fun insert(messages: List<ReceivedMessage>) {
        if (messages.isEmpty()) return
        dao.insert(messages.map { it.toRow() })
        dao.trim(keep)
    }

    override fun delete(ids: List<String>) {
        if (ids.isNotEmpty()) dao.delete(ids)
    }

    override fun idsForDevice(deviceId: String) = dao.idsForDevice(deviceId)

    override fun allIds() = dao.allIds()

    override fun contains(id: String) = dao.count(id) > 0

    /** Newest first, for the Alerts screen. */
    fun recent(limit: Int): List<ReceivedMessage> = dao.recent(limit).map { it.toMessage() }

    private fun ReceivedMessage.toRow() = ReceivedRow(id, deviceId, deviceName, type, app, appLabel, sender, body, receivedAt, code)

    private fun ReceivedRow.toMessage() = ReceivedMessage(id, deviceId, deviceName, type, app, appLabel, sender, body, receivedAt, code)
}
