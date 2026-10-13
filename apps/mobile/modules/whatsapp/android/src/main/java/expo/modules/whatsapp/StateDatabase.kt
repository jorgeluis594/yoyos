package expo.modules.whatsapp

import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File

/** A pending entry as stored: ordering columns in clear, the whole entry sealed under K_recovery. */
internal class SealedPending(
  val deliveryId: String,
  val createdRevision: String,
  val createdOrdinal: Long,
  val nonce: ByteArray,
  val ciphertext: ByteArray,
)

internal class StoredState(
  val storeId: String,
  val revision: String,
  val control: ByteArray,
  val session: ByteArray?,
  val pending: List<SealedPending>,
)

/** One publication: everything in it commits in a single SQLite transaction or not at all. */
internal class StateChange(
  val revision: String,
  val control: ByteArray,
  val sessionChanged: Boolean,
  val session: ByteArray?,
  val deletes: List<String> = emptyList(),
  val inserts: List<SealedPending> = emptyList(),
  val updates: List<SealedPending> = emptyList(),
)

/**
 * SQLite rows of the native state. Rollback journal with synchronous=FULL: a returned commit is durable.
 * Retiring one pending entry deletes one row instead of rewriting the whole state.
 */
internal class StateDatabase(file: File) : Closeable {
  private val db = open(file, SQLiteDatabase.OPEN_READWRITE)

  fun read(sessionLimit: Long, entryLimit: Long): StoredState {
    val (storeId, revision) = db.rawQuery("SELECT store_id, revision FROM meta WHERE id = 1", null).use {
      if (!it.moveToFirst()) throw StateFailure("SESSION_STATE_INVALID")
      it.getString(0) to it.getString(1)
    }
    val control = large("meta", "control", "id = 1", emptyArray(), 4096) ?: throw StateFailure("SESSION_STATE_INVALID")
    val session = large("session", "value", "id = 1", emptyArray(), sessionLimit)
    val keys = db.rawQuery("SELECT delivery_id, created_revision, created_ordinal, nonce FROM pending", null).use { cursor ->
      generateSequence { if (cursor.moveToNext()) cursor else null }
        .map { Triple(it.getString(0), it.getString(1) to it.getLong(2), it.getBlob(3)) }.toList()
    }
    val pending = keys.map { (id, order, nonce) ->
      val ciphertext = large("pending", "ciphertext", "delivery_id = ?", arrayOf(id), entryLimit) ?: throw StateFailure("SESSION_STATE_INVALID")
      SealedPending(id, order.first, order.second, nonce, ciphertext)
    }
    return StoredState(storeId, revision, control, session, pending)
  }

  fun write(change: StateChange, beforeCommit: () -> Unit) {
    db.beginTransaction()
    try {
      db.execSQL("UPDATE meta SET revision = ?, control = ? WHERE id = 1", arrayOf(change.revision, change.control))
      if (change.sessionChanged) {
        db.execSQL("DELETE FROM session")
        change.session?.let { db.execSQL("INSERT INTO session (id, value) VALUES (1, ?)", arrayOf(it)) }
      }
      for (id in change.deletes) db.execSQL("DELETE FROM pending WHERE delivery_id = ?", arrayOf(id))
      for (entry in change.inserts) db.execSQL(
        "INSERT INTO pending (delivery_id, created_revision, created_ordinal, nonce, ciphertext) VALUES (?, ?, ?, ?, ?)",
        arrayOf(entry.deliveryId, entry.createdRevision, entry.createdOrdinal, entry.nonce, entry.ciphertext),
      )
      for (entry in change.updates) {
        val statement = db.compileStatement("UPDATE pending SET nonce = ?, ciphertext = ? WHERE delivery_id = ?")
        statement.bindBlob(1, entry.nonce); statement.bindBlob(2, entry.ciphertext); statement.bindString(3, entry.deliveryId)
        if (statement.executeUpdateDelete() != 1) throw StateFailure("INVALID_REQUEST")
      }
      beforeCommit()
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }

  override fun close() = db.close()

  // Android's CursorWindow holds about 2 MB, so values that can be larger are read in slices.
  private fun large(table: String, column: String, where: String, args: Array<String>, limit: Long): ByteArray? {
    val length = db.rawQuery("SELECT length($column) FROM $table WHERE $where", args).use {
      if (!it.moveToFirst()) return null
      it.getLong(0)
    }
    if (length > limit) throw StateFailure("SESSION_STATE_INVALID")
    val output = ByteArrayOutputStream(length.toInt())
    var offset = 1L
    while (offset <= length) {
      db.rawQuery("SELECT substr($column, ?, ?) FROM $table WHERE $where", arrayOf(offset.toString(), CHUNK.toString(), *args)).use {
        if (!it.moveToFirst()) throw StateFailure("SESSION_STATE_INVALID")
        output.write(it.getBlob(0))
      }
      offset += CHUNK
    }
    if (output.size().toLong() != length) throw StateFailure("SESSION_STATE_INVALID")
    return output.toByteArray()
  }

  companion object {
    private const val CHUNK = 512 * 1024
    // The default handler deletes a corrupt database; a corrupt store must fail, never become empty.
    private val KEEP_CORRUPT = DatabaseErrorHandler { }
    private val SCHEMA = listOf(
      "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), store_id TEXT NOT NULL, revision TEXT NOT NULL, control BLOB NOT NULL)",
      "CREATE TABLE session (id INTEGER PRIMARY KEY CHECK (id = 1), value BLOB NOT NULL)",
      "CREATE TABLE pending (delivery_id TEXT PRIMARY KEY, created_revision TEXT NOT NULL, created_ordinal INTEGER NOT NULL, " +
        "nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, UNIQUE (created_revision, created_ordinal))",
    )

    private fun open(file: File, flags: Int): SQLiteDatabase =
      SQLiteDatabase.openDatabase(file.path, null, flags, KEEP_CORRUPT).apply {
        disableWriteAheadLogging() // also turns off Android's compatibility WAL
        // Atomic commits need a rollback journal on disk; refuse MEMORY or OFF, whatever the platform default.
        val mode = rawQuery("PRAGMA journal_mode = TRUNCATE", null).use { it.moveToFirst(); it.getString(0) }
        if (!mode.equals("truncate", ignoreCase = true)) throw StateFailure("STORAGE_FAILED")
        execSQL("PRAGMA synchronous = FULL")
        rawQuery("PRAGMA secure_delete = ON", null).use { it.moveToFirst() }
      }

    /** Creates a complete database at [file] (a temporary path the caller renames into place). */
    fun create(file: File, storeId: String, control: ByteArray) {
      open(file, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY).use { db ->
        db.beginTransaction()
        try {
          SCHEMA.forEach(db::execSQL)
          db.execSQL("INSERT INTO meta (id, store_id, revision, control) VALUES (1, ?, '0', ?)", arrayOf(storeId, control))
          db.setTransactionSuccessful()
        } finally { db.endTransaction() }
      }
    }
  }
}
