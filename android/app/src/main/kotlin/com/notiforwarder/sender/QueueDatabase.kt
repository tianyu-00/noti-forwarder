package com.notiforwarder.sender

import android.content.Context
import androidx.room.Dao
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/** A captured message waiting to be sent. Deleted only after the server confirms it. */
@Entity(
    tableName = "queued_messages",
    indices = [Index(value = ["quarantined", "nextAttemptAt", "enqueuedAt"])],
)
data class QueuedMessage(
    @PrimaryKey val id: String,
    val type: String,
    val app: String,
    val sender: String,
    val body: String,
    val receivedAt: String,
    val enqueuedAt: Long,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    /** The server will never accept it. Kept for inspection, never retried. */
    val quarantined: Boolean = false,
    /**
     * When the server confirmed it. A sent row is kept as a short history for the Activity tab,
     * with its text erased, and is never sent again.
     */
    val sentAt: Long? = null,
    /** The SIM that received a text, so the dashboard can answer on the same one. */
    val sim: Int? = null,
)

/** A message received from the server, kept as received (still encrypted when it was) so the receiver can show it again. */
@Entity(tableName = "received_messages", indices = [Index(value = ["receivedAt", "id"]), Index(value = ["deviceId"])])
data class ReceivedRow(
    @PrimaryKey val id: String,
    val deviceId: String,
    val deviceName: String?,
    val type: String,
    val app: String,
    val appLabel: String?,
    val sender: String,
    val body: String,
    val receivedAt: String,
    val code: String?,
)

@Dao
interface ReceivedDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insert(rows: List<ReceivedRow>)

    @Query("SELECT * FROM received_messages ORDER BY receivedAt DESC, id DESC LIMIT :limit")
    fun recent(limit: Int): List<ReceivedRow>

    @Query("SELECT id, receivedAt FROM received_messages")
    fun refs(): List<RefRow>

    @Query("SELECT id FROM received_messages")
    fun allIds(): List<String>

    @Query("SELECT id FROM received_messages WHERE deviceId = :deviceId")
    fun idsForDevice(deviceId: String): List<String>

    @Query("SELECT COUNT(*) FROM received_messages WHERE id = :id")
    fun count(id: String): Int

    @Query("DELETE FROM received_messages WHERE id IN (:ids)")
    fun delete(ids: List<String>)

    /** Keeps the newest [keep] and forgets older ones. */
    @Query(
        "DELETE FROM received_messages WHERE id NOT IN " +
            "(SELECT id FROM received_messages ORDER BY receivedAt DESC, id DESC LIMIT :keep)",
    )
    fun trim(keep: Int)
}

data class RefRow(val id: String, val receivedAt: String)

@Dao
interface QueueDao {
    /** Returns -1 when a message with this id is already queued. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insert(message: QueuedMessage): Long

    // rowid breaks ties so messages enqueued in the same millisecond keep their order.
    @Query(
        "SELECT * FROM queued_messages WHERE sentAt IS NULL AND quarantined = 0 AND nextAttemptAt <= :now " +
            "ORDER BY enqueuedAt, rowid LIMIT :limit",
    )
    fun due(now: Long, limit: Int): List<QueuedMessage>

    @Query(
        "SELECT * FROM queued_messages WHERE sentAt IS NULL AND type = 'notification' " +
            "AND app IN (:apps) AND enqueuedAt >= :since",
    )
    fun notificationsFrom(apps: List<String>, since: Long): List<QueuedMessage>

    @Query("DELETE FROM queued_messages WHERE id IN (:ids)")
    fun delete(ids: List<String>)

    @Query("UPDATE queued_messages SET attempts = attempts + 1, nextAttemptAt = :at WHERE id IN (:ids)")
    fun retryLater(ids: List<String>, at: Long)

    @Query("UPDATE queued_messages SET quarantined = 1 WHERE id = :id")
    fun quarantine(id: String)

    // Only messages that already failed (attempts > 0): one held back on purpose has none.
    @Query("UPDATE queued_messages SET nextAttemptAt = 0 WHERE sentAt IS NULL AND quarantined = 0 AND attempts > 0")
    fun retryNow()

    @Query("UPDATE queued_messages SET sentAt = :at, body = '' WHERE id IN (:ids)")
    fun markSent(ids: List<String>, at: Long)

    /** Keeps the newest [keep] sent rows and forgets older ones. Rows still waiting are never touched. */
    @Query(
        "DELETE FROM queued_messages WHERE sentAt IS NOT NULL AND id NOT IN " +
            "(SELECT id FROM queued_messages WHERE sentAt IS NOT NULL ORDER BY sentAt DESC, rowid DESC LIMIT :keep)",
    )
    fun pruneSent(keep: Int)

    /** Sent, waiting and refused rows together, newest first. */
    @Query("SELECT * FROM queued_messages ORDER BY COALESCE(sentAt, enqueuedAt) DESC, rowid DESC LIMIT :limit")
    fun recent(limit: Int): List<QueuedMessage>

    @Query("SELECT COUNT(*) FROM queued_messages WHERE sentAt IS NULL AND quarantined = 0")
    fun count(): Int

    @Query("SELECT COUNT(*) FROM queued_messages WHERE sentAt IS NULL AND quarantined = 1")
    fun quarantinedCount(): Int

    @Query("SELECT MIN(nextAttemptAt) FROM queued_messages WHERE sentAt IS NULL AND quarantined = 0 AND nextAttemptAt > :now")
    fun nextDueAt(now: Long): Long?
}

// Version 4 adds the table of messages a receiver has received.
// Version 2 adds the nullable sentAt column and version 3 the nullable sim column; Room writes the migration from the two schema files.
@Database(
    entities = [QueuedMessage::class, ReceivedRow::class],
    version = 4,
    exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3), AutoMigration(from = 3, to = 4)],
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun queueDao(): QueueDao
    abstract fun receivedDao(): ReceivedDao

    companion object {
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "notiforwarder.db").build()
    }
}
