package com.notiforwarder.sender

import android.content.Context
import androidx.room.Dao
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
)

@Dao
interface QueueDao {
    /** Returns -1 when a message with this id is already queued. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insert(message: QueuedMessage): Long

    // rowid breaks ties so messages enqueued in the same millisecond keep their order.
    @Query(
        "SELECT * FROM queued_messages WHERE quarantined = 0 AND nextAttemptAt <= :now " +
            "ORDER BY enqueuedAt, rowid LIMIT :limit",
    )
    fun due(now: Long, limit: Int): List<QueuedMessage>

    @Query("DELETE FROM queued_messages WHERE id IN (:ids)")
    fun delete(ids: List<String>)

    @Query("UPDATE queued_messages SET attempts = attempts + 1, nextAttemptAt = :at WHERE id IN (:ids)")
    fun retryLater(ids: List<String>, at: Long)

    @Query("UPDATE queued_messages SET quarantined = 1 WHERE id = :id")
    fun quarantine(id: String)

    @Query("SELECT COUNT(*) FROM queued_messages WHERE quarantined = 0")
    fun count(): Int

    @Query("SELECT COUNT(*) FROM queued_messages WHERE quarantined = 1")
    fun quarantinedCount(): Int

    @Query("SELECT MIN(nextAttemptAt) FROM queued_messages WHERE quarantined = 0 AND nextAttemptAt > :now")
    fun nextDueAt(now: Long): Long?
}

@Database(entities = [QueuedMessage::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun queueDao(): QueueDao

    companion object {
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "notiforwarder.db").build()
    }
}
