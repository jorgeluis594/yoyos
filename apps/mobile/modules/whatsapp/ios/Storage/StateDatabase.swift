import Foundation
import SQLite3

/// A pending entry as stored: ordering columns in clear, the whole entry sealed under K_recovery.
struct SealedPending {
  let deliveryId: String
  let createdRevision: String
  let createdOrdinal: Int64
  let nonce: Data
  let ciphertext: Data
}

struct StoredState {
  let storeId: String
  let revision: String
  let control: Data
  let session: Data?
  let pending: [SealedPending]
}

/// One publication: everything in it commits in a single SQLite transaction or not at all.
struct StateChange {
  let revision: String
  let control: Data
  let sessionChanged: Bool
  let session: Data?
  var deletes: [String] = []
  var inserts: [SealedPending] = []
  var updates: [SealedPending] = []
}

/// SQLite rows of the native state. Rollback journal with synchronous=FULL: a returned commit is durable.
/// Retiring one pending entry deletes one row instead of rewriting the whole state.
final class StateDatabase {
  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  private static let schema = [
    "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), store_id TEXT NOT NULL, revision TEXT NOT NULL, control BLOB NOT NULL)",
    "CREATE TABLE session (id INTEGER PRIMARY KEY CHECK (id = 1), value BLOB NOT NULL)",
    "CREATE TABLE pending (delivery_id TEXT PRIMARY KEY, created_revision TEXT NOT NULL, created_ordinal INTEGER NOT NULL, " +
      "nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, UNIQUE (created_revision, created_ordinal))",
  ]
  private var db: OpaquePointer?

  init(path: String, create: Bool = false) throws {
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX | (create ? SQLITE_OPEN_CREATE : 0)
    guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK else { sqlite3_close(db); db = nil; throw StateStoreError.invalid }
    do {
      // Atomic commits need a rollback journal on disk; refuse MEMORY or OFF.
      guard try rows("PRAGMA journal_mode = TRUNCATE", [], { Self.text($0) }).first??.lowercased() == "truncate" else { throw StateStoreError.storage }
      try execute("PRAGMA synchronous = FULL")
      _ = try rows("PRAGMA secure_delete = ON", []) { Self.text($0) }
    } catch {
      sqlite3_close(db); db = nil
      throw error
    }
  }

  deinit { sqlite3_close(db) }

  /// Creates a complete database at [path] (a temporary path the caller renames into place).
  static func create(path: String, storeId: String, control: Data) throws {
    let database = try StateDatabase(path: path, create: true)
    try database.transaction {
      for statement in schema { try database.execute(statement) }
      try database.execute("INSERT INTO meta (id, store_id, revision, control) VALUES (1, ?, '0', ?)", [storeId, control])
    }
  }

  func read(sessionLimit: Int, entryLimit: Int) throws -> StoredState {
    guard let meta = try rows("SELECT store_id, revision, control FROM meta WHERE id = 1", [], { statement in
      (Self.text(statement, 0), Self.text(statement, 1), Self.blob(statement, 2))
    }).first, let storeId = meta.0, let revision = meta.1, let control = meta.2, control.count <= 4096 else { throw StateStoreError.invalid }
    let session = try rows("SELECT value FROM session WHERE id = 1", []) { Self.blob($0, 0) }.first ?? nil
    if let session, session.count > sessionLimit { throw StateStoreError.invalid }
    let pending = try rows("SELECT delivery_id, created_revision, created_ordinal, nonce, ciphertext FROM pending", []) { statement -> SealedPending? in
      guard let id = Self.text(statement, 0), let created = Self.text(statement, 1),
            let nonce = Self.blob(statement, 3), let ciphertext = Self.blob(statement, 4) else { return nil }
      return SealedPending(deliveryId: id, createdRevision: created, createdOrdinal: sqlite3_column_int64(statement, 2), nonce: nonce, ciphertext: ciphertext)
    }
    let entries = try pending.map { entry -> SealedPending in
      guard let entry, entry.ciphertext.count <= entryLimit else { throw StateStoreError.invalid }
      return entry
    }
    return StoredState(storeId: storeId, revision: revision, control: control, session: session, pending: entries)
  }

  func write(_ change: StateChange, beforeCommit: () throws -> Void) throws {
    try transaction {
      try execute("UPDATE meta SET revision = ?, control = ? WHERE id = 1", [change.revision, change.control])
      if change.sessionChanged {
        try execute("DELETE FROM session")
        if let session = change.session { try execute("INSERT INTO session (id, value) VALUES (1, ?)", [session]) }
      }
      for id in change.deletes { try execute("DELETE FROM pending WHERE delivery_id = ?", [id]) }
      for entry in change.inserts {
        try execute("INSERT INTO pending (delivery_id, created_revision, created_ordinal, nonce, ciphertext) VALUES (?, ?, ?, ?, ?)",
                    [entry.deliveryId, entry.createdRevision, entry.createdOrdinal, entry.nonce, entry.ciphertext])
      }
      for entry in change.updates {
        try execute("UPDATE pending SET nonce = ?, ciphertext = ? WHERE delivery_id = ?", [entry.nonce, entry.ciphertext, entry.deliveryId])
        guard sqlite3_changes(db) == 1 else { throw StateStoreError.invalidRequest }
      }
      try beforeCommit()
    }
  }

  private func transaction(_ body: () throws -> Void) throws {
    try execute("BEGIN IMMEDIATE")
    do {
      try body()
      try execute("COMMIT")
    } catch {
      sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
      throw error
    }
  }

  private func execute(_ sql: String, _ arguments: [Any] = []) throws {
    let statement = try prepare(sql, arguments)
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_DONE else { throw StateStoreError.storage }
  }

  private func rows<T>(_ sql: String, _ arguments: [Any], _ read: (OpaquePointer) throws -> T) throws -> [T] {
    let statement = try prepare(sql, arguments)
    defer { sqlite3_finalize(statement) }
    var result = [T]()
    while true {
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return result }
      guard status == SQLITE_ROW else { throw StateStoreError.invalid }
      result.append(try read(statement))
    }
  }

  private func prepare(_ sql: String, _ arguments: [Any]) throws -> OpaquePointer {
    var prepared: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &prepared, nil) == SQLITE_OK, let statement = prepared else {
      sqlite3_finalize(prepared)
      throw StateStoreError.storage
    }
    for (index, argument) in arguments.enumerated() {
      let position = Int32(index + 1)
      let status: Int32
      switch argument {
      case let value as String: status = sqlite3_bind_text(statement, position, value, -1, Self.transient)
      case let value as Int64: status = sqlite3_bind_int64(statement, position, value)
      case let value as Data:
        status = value.withUnsafeBytes { sqlite3_bind_blob(statement, position, $0.baseAddress, Int32($0.count), Self.transient) }
      default: status = SQLITE_MISUSE
      }
      guard status == SQLITE_OK else { sqlite3_finalize(statement); throw StateStoreError.storage }
    }
    return statement
  }

  private static func text(_ statement: OpaquePointer, _ column: Int32 = 0) -> String? {
    guard let value = sqlite3_column_text(statement, column) else { return nil }
    return String(cString: value)
  }

  private static func blob(_ statement: OpaquePointer, _ column: Int32) -> Data? {
    guard sqlite3_column_type(statement, column) == SQLITE_BLOB else { return nil }
    let count = Int(sqlite3_column_bytes(statement, column))
    guard let bytes = sqlite3_column_blob(statement, column) else { return count == 0 ? Data() : nil }
    return Data(bytes: bytes, count: count)
  }
}
