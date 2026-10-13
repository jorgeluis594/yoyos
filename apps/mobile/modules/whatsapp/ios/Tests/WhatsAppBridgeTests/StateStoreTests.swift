import XCTest
import Foundation
import Security
import CryptoKit
import Darwin
import SQLite3
#if !WA02_APP_HOSTED
@testable import WhatsAppStateStore
#endif

final class StateStoreTests: XCTestCase {
  private func persistCrashMarker(_ value: String, at url: URL) throws {
    try Data(value.utf8).write(to: url)
    let handle = try FileHandle(forWritingTo: url)
    try handle.synchronize()
    try handle.close()
  }

  func testResetCrashMatrix() throws {
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
    let plan = support.appendingPathComponent("wa02-crash-matrix", isDirectory: true)
    try FileManager.default.createDirectory(at: plan, withIntermediateDirectories: true)
    let run = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    try persistCrashMarker(run, at: plan.appendingPathComponent("run"))
    try persistCrashMarker("ready:0", at: plan.appendingPathComponent("step"))
  }

  // CI invokes each phase twice: a process kill, then a separately successful recovery.
  func testProcessCrashMatrix() throws {
    let phases = ["beforeCommit", "afterCommit", "response"]
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
    let plan = support.appendingPathComponent("wa02-crash-matrix", isDirectory: true)
    let marker = plan.appendingPathComponent("step")
    let run = try String(contentsOf: plan.appendingPathComponent("run"), encoding: .utf8)
    let parts = try String(contentsOf: marker, encoding: .utf8).split(separator: ":")
    guard run.count == 32, parts.count == 2, let step = Int(parts[1]), phases.indices.contains(step),
          parts[0] == "ready" || parts[0] == "crashed" else { XCTFail("Invalid crash plan"); return }
    let root = plan.appendingPathComponent(run, isDirectory: true)
      .appendingPathComponent(String(step), isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let suffix = SHA256.hash(data: Data("\(run):\(step)".utf8)).prefix(16)
      .map { String(format: "%02x", $0) }.joined()
    var armed = false
    let writer = try NativeStateStore(directory: root, serviceSuffix: suffix) { reached in
      if armed && reached == phases[step] {
        try self.persistCrashMarker("crashed:\(step)", at: marker)
        _ = Darwin.kill(Darwin.getpid(), SIGKILL)
        Darwin._exit(137)
      }
    }
    if parts[0] == "ready" {
      _ = try writer.open()
      try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
      let session = try XCTUnwrap(writer.open()["session"] as? [String: Any])
      let sessionId = try XCTUnwrap(session["sessionKeyId"] as? String)
      armed = true
      _ = try writer.commit(expectedRevision: "1") { current in
        let pending: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32),
                                      "accountId": "123@lid", "createdRevision": "2", "createdOrdinal": 0,
                                      "source": "live", "identityState": "pendingLid",
                                      "recovery": ["messageInfoJson": "{}", "items": [Any]()]]
        var next = current
        next["session"] = NSNull()
        next["sessionKeysToDelete"] = [sessionId]
        next["pending"] = [pending]
        var options = current["options"] as! [String: Int]
        options["maxImageStorageBytes"] = 123
        next["options"] = options
        return next
      }
      XCTFail("Publication phase \(phases[step]) did not terminate the process")
      return
    }
    let state = try writer.open()
    let replaced = step >= 1
    let pending = state["pending"] as? [[String: Any]]
    let retired = state["sessionKeysToDelete"] as? [String]
    let options = state["options"] as? [String: Int]
    let account = (state["session"] as? [String: Any])?["accountId"] as? String
    let sessionMatches = replaced ? state["session"] is NSNull : account == "123@lid"
    let pendingMatches = pending?.count == (replaced ? 1 : 0)
    let pendingRevision = pending?.first?["createdRevision"] as? String
    let publishedRevision = try revision(root)
    let hasTemporary = FileManager.default.fileExists(atPath: root.appendingPathComponent("whatsapp/state.db.next").path)
    let restorable: Bool
    if replaced { restorable = true }
    else { restorable = try writer.canRestoreSession() }
    guard retired?.isEmpty == true, sessionMatches, pendingMatches,
          options?["maxImageStorageBytes"] == (replaced ? 123 : 50 * 1024 * 1024),
          !replaced || pendingRevision == "2", publishedRevision == (replaced ? "3" : "1"),
          !hasTemporary, restorable else { XCTFail("Crash recovery mixed session and pending at \(phases[step])"); return }
    try persistCrashMarker("ready:\(step + 1)", at: marker)
  }

  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func makeStore(_ root: URL, fault: ((String) throws -> Void)? = nil) throws -> NativeStateStore {
    try NativeStateStore(directory: root, serviceSuffix: root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased(), fault: fault)
  }

  private func keychainData(_ root: URL, id: String) throws -> Data {
    let suffix = root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: "com.yoyos.whatsapp.state.test." + suffix,
                                kSecAttrAccount as String: id, kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne,
                                kSecUseDataProtectionKeychain as String: true]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { throw StateStoreError.storage }
    return try XCTUnwrap(result as? Data)
  }

  private func creationRecord(_ root: URL) throws -> [String: Any] {
    try NativeStateStore.parseObject(keychainData(root, id: "record"))
  }

  private func stateFile(_ root: URL) -> URL { root.appendingPathComponent("whatsapp/state.db") }

  /// Runs one statement against the store's database and returns the first column of each row.
  @discardableResult
  private func sql(_ root: URL, _ statement: String, _ arguments: [Any] = []) throws -> [Data?] {
    var db: OpaquePointer?
    guard sqlite3_open_v2(stateFile(root).path, &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else { sqlite3_close(db); throw StateStoreError.storage }
    defer { sqlite3_close(db) }
    var prepared: OpaquePointer?
    guard sqlite3_prepare_v2(db, statement, -1, &prepared, nil) == SQLITE_OK else { throw StateStoreError.storage }
    defer { sqlite3_finalize(prepared) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, argument) in arguments.enumerated() {
      let position = Int32(index + 1)
      switch argument {
      case let value as String: sqlite3_bind_text(prepared, position, value, -1, transient)
      case let value as Int: sqlite3_bind_int64(prepared, position, Int64(value))
      case let value as Data: _ = value.withUnsafeBytes { sqlite3_bind_blob(prepared, position, $0.baseAddress, Int32($0.count), transient) }
      default: throw StateStoreError.storage
      }
    }
    var rows = [Data?]()
    while true {
      let status = sqlite3_step(prepared)
      if status == SQLITE_DONE { return rows }
      guard status == SQLITE_ROW else { throw StateStoreError.storage }
      guard let bytes = sqlite3_column_blob(prepared, 0) else { rows.append(nil); continue }
      rows.append(Data(bytes: bytes, count: Int(sqlite3_column_bytes(prepared, 0))))
    }
  }

  private func revision(_ root: URL) throws -> String {
    String(decoding: try XCTUnwrap(try sql(root, "SELECT revision FROM meta").first ?? nil), as: UTF8.self)
  }

  private func sessionValue(_ root: URL) throws -> Data? { try sql(root, "SELECT value FROM session").first ?? nil }

  /// Inserts [entry] the way the store seals it, bypassing every store check.
  private func insertSealedPending(_ root: URL, _ entry: [String: Any]) throws {
    let record = try creationRecord(root)
    let key = SymmetricKey(data: try keychainData(root, id: try XCTUnwrap(record["recoveryKeyId"] as? String)))
    let id = try XCTUnwrap(entry["deliveryId"] as? String)
    let created = try XCTUnwrap(entry["createdRevision"] as? String)
    let ordinal = try XCTUnwrap(entry["createdOrdinal"] as? Int)
    let aad = Data("[\"yoyos-whatsapp-pending\",1,\"\(try XCTUnwrap(record["storeId"] as? String))\",\"\(id)\",\"\(created)\",\(ordinal)]".utf8)
    let sealed = try AES.GCM.seal(try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]), using: key, authenticating: aad)
    try sql(root, "INSERT INTO pending (delivery_id, created_revision, created_ordinal, nonce, ciphertext) VALUES (?, ?, ?, ?, ?)",
            [id, created, ordinal, Data(sealed.nonce), sealed.ciphertext + sealed.tag])
  }

  func testStrictJsonRejectsDuplicateKeysAndMalformedNumbers() {
    for text in ["{\"a\":1,\"a\":2}", #"{"a":1,"\u0061":2}"#, "{\"a\":01}", "{\"a\":1,}", "{\"a\":+1}", "{\"a\":NaN}", #"{"a":"\ud800"}"#] {
      XCTAssertThrowsError(try StrictStateJSON.check(text))
    }
    XCTAssertNoThrow(try StrictStateJSON.check("{\"a\":[true,null,3]}"))
    XCTAssertNoThrow(try StrictStateJSON.check(String(repeating: "[", count: 63) + "0" + String(repeating: "]", count: 63)))
    XCTAssertThrowsError(try StrictStateJSON.check(String(repeating: "[", count: 65) + "0" + String(repeating: "]", count: 65)))
    XCTAssertThrowsError(try NativeStateStore.parseObject(Data([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])))
  }

  func testPublishedStateSurvivesReopenAndIgnoresNextFile() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    let initial = try store.open()
    let images = root.appendingPathComponent("whatsapp/images")
    XCTAssertTrue((try images.resourceValues(forKeys: [.isExcludedFromBackupKey])).isExcludedFromBackup == true)
    let protected = try stateFile(root).resourceValues(forKeys: [.isExcludedFromBackupKey, .fileProtectionKey])
    XCTAssertTrue(protected.isExcludedFromBackup == true)
    XCTAssertEqual(protected.fileProtection, .completeUntilFirstUserAuthentication)
    let keyId = try XCTUnwrap((try creationRecord(root))["recoveryKeyId"] as? String)
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: keyId, kSecReturnAttributes as String: true,
                                kSecUseDataProtectionKeychain as String: true]
    var result: CFTypeRef?
    XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
    let attributes = try XCTUnwrap(result as? [String: Any])
    XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
    XCTAssertFalse((attributes[kSecAttrSynchronizable as String] as? Bool) ?? false)
    XCTAssertEqual((initial["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 10 * 1024 * 1024)
    _ = try store.commit(expectedRevision: "0") { state in
      var next = state
      next["options"] = ["maxRecoveryBufferBytes": 20 * 1024 * 1024, "maxImageStorageBytes": 50 * 1024 * 1024]
      return next
    }
    let directory = root.appendingPathComponent("whatsapp")
    try Data("uncommitted".utf8).write(to: directory.appendingPathComponent("state.db.next"))
    let recovered = try makeStore(root).open()
    XCTAssertEqual((recovered["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 20 * 1024 * 1024)
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("state.db.next").path))
  }

  func testTrustedReadBudgetSurvivesGrowthReductionFailureAndDrain() throws {
    let largeInfo = "{\"padding\":\"" + String(repeating: "A", count: 10 * 1024 * 1024) + "\"}"
    let pending: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32),
                                  "accountId": "123@lid", "createdRevision": "1", "createdOrdinal": 0,
                                  "source": "live", "identityState": "pendingLid",
                                  "recovery": ["messageInfoJson": largeInfo, "items": [[String: Any]]()]]
    func grow(_ state: [String: Any]) throws -> [String: Any] {
      var next = state
      var options = try XCTUnwrap(state["options"] as? [String: Int])
      options["maxRecoveryBufferBytes"] = 12 * 1024 * 1024
      next["options"] = options
      next["pending"] = [pending]
      return next
    }
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    _ = try writer.commit(expectedRevision: "0", change: grow)
    XCTAssertEqual((try creationRecord(root))["readBudget"] as? Int, 12 * 1024 * 1024)
    let grown = try makeStore(root).open()
    XCTAssertEqual(((grown["pending"] as? [[String: Any]])?.first?["recovery"] as? [String: Any])?["messageInfoJson"] as? String, largeInfo)
    _ = try writer.commit(expectedRevision: "1") { state in
      var next = state
      var options = try XCTUnwrap(state["options"] as? [String: Int])
      options["maxRecoveryBufferBytes"] = 1024
      next["options"] = options
      return next
    }
    let reduced = try makeStore(root).open()
    XCTAssertEqual((reduced["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 1024)
    XCTAssertEqual(((reduced["pending"] as? [[String: Any]])?.first?["recovery"] as? [String: Any])?["messageInfoJson"] as? String, largeInfo)
    XCTAssertEqual((try creationRecord(root))["readBudget"] as? Int, 12 * 1024 * 1024)
    _ = try writer.commit(expectedRevision: "2") { state in
      var next = state; next["pending"] = [[String: Any]](); return next
    }
    XCTAssertEqual((try makeStore(root).open()["pending"] as? [[String: Any]])?.count, 0)
    XCTAssertEqual(try revision(root), "3")

    for phase in ["recordResponse", "beforeCommit"] {
      let failedRoot = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: failedRoot) }
      var active = false
      let failedWriter = try makeStore(failedRoot) { if active && $0 == phase { throw StateStoreError.storage } }
      _ = try failedWriter.open()
      active = true
      XCTAssertThrowsError(try failedWriter.commit(expectedRevision: "0", change: grow))
      XCTAssertEqual(try revision(failedRoot), "0")
      let recovered = try makeStore(failedRoot).open()
      XCTAssertEqual((recovered["pending"] as? [[String: Any]])?.count, 0)
      XCTAssertEqual((recovered["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 10 * 1024 * 1024)
      XCTAssertEqual((try creationRecord(failedRoot))["readBudget"] as? Int, 12 * 1024 * 1024)
    }
  }

  func testRecoveryOnlyCommitPreservesSessionCiphertext() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    try store.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let original = try XCTUnwrap((store.open()["session"] as? [String: Any])?["ciphertextBase64"] as? String)
    let storedSession = try sessionValue(root)
    let next = try store.commit(expectedRevision: "1") { $0 }
    XCTAssertEqual((next["session"] as? [String: Any])?["ciphertextBase64"] as? String, original)
    XCTAssertEqual(try sessionValue(root), storedSession)
    XCTAssertEqual(try revision(root), "2")
    XCTAssertTrue(try makeStore(root).canRestoreSession())
    let first = try XCTUnwrap(store.open()["session"] as? [String: Any])
    try store.endSession()
    XCTAssertTrue(try makeStore(root).open()["session"] is NSNull)
    try store.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let second = try XCTUnwrap(store.open()["session"] as? [String: Any])
    XCTAssertNotEqual(first["sessionKeyId"] as? String, second["sessionKeyId"] as? String)
    XCTAssertNotEqual(first["nonceBase64"] as? String, second["nonceBase64"] as? String)
  }

  func testSessionFieldsAreAuthenticatedIndependentlyOfRecoveryRevision() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    try store.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let original = try XCTUnwrap(store.open()["session"] as? [String: Any])
    let bad: [([String: Any]) -> [String: Any]] = [
      { var session = $0; session["accountId"] = "456@lid"; return session },
      { var session = $0; session["sessionRevision"] = "0"; return session },
      { var session = $0; let value = session["sessionKeyId"] as! String; session["sessionKeyId"] = (value.first == "0" ? "1" : "0") + String(value.dropFirst()); return session },
      { var session = $0; session["sessionKeyId"] = (session["sessionKeyId"] as! String) + "\n"; return session },
      { var session = $0; session["sessionKeyId"] = (session["sessionKeyId"] as! String) + "\r\n"; return session },
      { var session = $0; let value = session["nonceBase64"] as! String; session["nonceBase64"] = (value.first == "A" ? "B" : "A") + String(value.dropFirst()); return session },
      { var session = $0; let value = session["ciphertextBase64"] as! String; session["ciphertextBase64"] = (value.first == "A" ? "B" : "A") + String(value.dropFirst()); return session },
    ]
    for mutate in bad {
      XCTAssertThrowsError(try store.commit(expectedRevision: "1") { current in
        var next = current; next["session"] = mutate(original); return next
      })
      XCTAssertTrue(try store.canRestoreSession())
    }
  }

  func testInterruptedCreationResumes() throws {
    for phase in ["recordResponse", "creationRecord", "recoveryKey", "initialPublication"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      XCTAssertThrowsError(try makeStore(root) { if $0 == phase { throw StateStoreError.storage } }.open())
      let recovered = try makeStore(root).open()
      XCTAssertTrue(recovered["session"] is NSNull)
    }
  }

  func testCreatingRecordRemovesPartialTemporaryBeforeReusingRecoveryKey() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    XCTAssertThrowsError(try makeStore(root) { if $0 == "recoveryKey" { throw StateStoreError.storage } }.open())
    let record = try creationRecord(root)
    XCTAssertEqual(record["status"] as? String, "creating")
    let recoveryId = try XCTUnwrap(record["recoveryKeyId"] as? String)
    let originalKey = try keychainData(root, id: recoveryId)
    let sealed = try AES.GCM.seal(Data("partial".utf8), using: SymmetricKey(data: originalKey))
    let partial = Data("YOYOWA01".utf8) + Data(sealed.ciphertext.prefix(4))
    let next = root.appendingPathComponent("whatsapp/state.db.next")
    try FileManager.default.createDirectory(at: next, withIntermediateDirectories: false)
    try partial.write(to: next.appendingPathComponent("partial"))
    XCTAssertThrowsError(try makeStore(root).open())
    XCTAssertFalse(FileManager.default.fileExists(atPath: stateFile(root).path))
    XCTAssertEqual((try creationRecord(root))["status"] as? String, "creating")
    XCTAssertEqual(try keychainData(root, id: recoveryId), originalKey)
    try FileManager.default.removeItem(at: next)
    try partial.write(to: next)
    let recovered = try makeStore(root).open()
    XCTAssertTrue(recovered["session"] is NSNull)
    XCTAssertFalse(FileManager.default.fileExists(atPath: next.path))
    XCTAssertEqual((try creationRecord(root))["status"] as? String, "ready")
    XCTAssertEqual((try creationRecord(root))["recoveryKeyId"] as? String, recoveryId)
    XCTAssertEqual(try keychainData(root, id: recoveryId), originalKey)
  }

  func testProvisionalSessionRecoveryKeepsOnlyPublishedSession() throws {
    for phase in ["provisionalRecord", "sessionKey", "sessionPublished"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var active = false
      let writer = try makeStore(root) { if active && $0 == phase { throw StateStoreError.storage } }
      _ = try writer.open(); active = true
      XCTAssertThrowsError(try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8)))
      let recovered = try makeStore(root).open()
      XCTAssertEqual(recovered["session"] is NSNull, phase != "sessionPublished")
    }
  }

  func testSameWriterRetryRemovesOnlyItsUnpublishedSessionKey() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    var fail = true
    var cleanupFail = false
    let writer = try makeStore(root) { phase in
      if phase == "sessionKey" && fail { fail = false; throw StateStoreError.storage }
      if phase == "cleanupProvisional" && cleanupFail { cleanupFail = false; throw StateStoreError.storage }
    }
    _ = try writer.open()
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    func accounts() throws -> Set<String> {
      let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                  kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll,
                                  kSecUseDataProtectionKeychain as String: true]
      var result: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let items = result as? [[String: Any]] else { throw StateStoreError.storage }
      return Set(items.compactMap { $0[kSecAttrAccount as String] as? String }.filter { $0 != "record" })
    }
    let before = try accounts()
    XCTAssertThrowsError(try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{}".utf8)))
    XCTAssertEqual(try accounts(), before)
    let valid = Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8)
    XCTAssertThrowsError(try writer.beginSession(accountId: "123@lid", protocolBytes: valid))
    let orphan = try accounts().subtracting(before)
    XCTAssertEqual(orphan.count, 1)
    cleanupFail = true
    XCTAssertThrowsError(try writer.open())
    XCTAssertEqual(try accounts().subtracting(before), orphan)
    _ = try writer.open()
    try writer.beginSession(accountId: "123@lid", protocolBytes: valid)
    let after = try accounts()
    XCTAssertTrue(orphan.isDisjoint(with: after))
    XCTAssertEqual(after.count, before.count + 1)
  }

  func testLostProvisionalRecordResponseForcesSameWriterReadback() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    var active = false
    let writer = try makeStore(root) { phase in
      if active && phase == "recordResponse" { active = false; throw StateStoreError.storage }
    }
    _ = try writer.open()
    active = true
    let valid = Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8)
    XCTAssertThrowsError(try writer.beginSession(accountId: "123@lid", protocolBytes: valid))
    XCTAssertTrue(try writer.open()["session"] is NSNull)
    try writer.beginSession(accountId: "123@lid", protocolBytes: valid)
    XCTAssertTrue(try makeStore(root).canRestoreSession())
  }

  func testInjectedPublicationFailuresPreserveAReadableRevision() throws {
    for phase in ["beforeCommit", "afterCommit", "response"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var active = false
      let store = try makeStore(root) { reached in
        if active && reached == phase { throw StateStoreError.storage }
      }
      _ = try store.open()
      active = true
      XCTAssertThrowsError(try store.commit(expectedRevision: "0") { $0 })
      XCTAssertEqual(try revision(root), phase == "beforeCommit" ? "0" : "1")
      XCTAssertNoThrow(try makeStore(root).open())
    }
  }

  func testUncertainPublicationIsRereadBeforeNextMutation() throws {
    for phase in ["afterCommit", "response"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var active = false
      let writer = try makeStore(root) { reached in
        if active && reached == phase { active = false; throw StateStoreError.storage }
      }
      _ = try writer.open(); active = true
      XCTAssertThrowsError(try writer.commit(expectedRevision: "0") { $0 })
      _ = try writer.commit(expectedRevision: "1") { state in
        var next = state
        next["options"] = ["maxRecoveryBufferBytes": 10 * 1024 * 1024, "maxImageStorageBytes": 123]
        return next
      }
      let options = try XCTUnwrap(makeStore(root).open()["options"] as? [String: Int])
      XCTAssertEqual(options["maxImageStorageBytes"], 123)
    }
  }

  func testPendingRemainsReadableWithoutSessionKey() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let session = try XCTUnwrap(writer.open()["session"] as? [String: Any])
    let keyId = try XCTUnwrap(session["sessionKeyId"] as? String)
    _ = try writer.commit(expectedRevision: "1") { current in
      var next = current
      next["pending"] = [["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32),
                           "accountId": "123@lid", "createdRevision": "2", "createdOrdinal": 0,
                           "source": "live", "identityState": "pendingLid",
                           "recovery": ["messageInfoJson": "{}", "items": [[String: Any]]()]]]
      return next
    }
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: keyId, kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(query as CFDictionary), errSecSuccess)
    let recovered = try makeStore(root)
    XCTAssertEqual((try recovered.open()["pending"] as? [[String: Any]])?.count, 1)
    XCTAssertFalse(try recovered.canRestoreSession())
  }

  func testPendingFormatAndIdentitySurviveRestartAndRejectIncoherence() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    let encoded = Data("[\"123@lid\",\"456@lid\",\"ABC\"]".utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    let id = "wa-message:v1:" + encoded
    let message: [String: Any] = ["id": id, "accountId": "123@lid", "whatsappMessageId": "ABC",
                                  "chatId": "456@lid", "direction": "incoming", "timestamp": 123456789,
                                  "image": ["reference": ["messageId": id, "downloadReference": "opaque"]]]
    func pending() -> [String: Any] {
      ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32), "accountId": "123@lid",
       "createdRevision": "1", "createdOrdinal": 0, "source": "live", "identityState": "resolved",
       "message": message, "recovery": ["messageInfoJson": "{}", "items": [["format": "v2",
           "plaintextBase64": "AQ==", "ciphertextHashBase64": Data(repeating: 0, count: 32).base64EncodedString()]]]]
    }
    _ = try store.commit(expectedRevision: "0") { current in
      var next = current; next["pending"] = [pending()]; return next
    }
    let recovered = try makeStore(root).open()
    let items = try XCTUnwrap(recovered["pending"] as? [[String: Any]])
    XCTAssertEqual((items[0]["message"] as? [String: Any])?["id"] as? String, id)
    let bad: [([String: Any]) -> [String: Any]] = [
      { var item = $0; var message = item["message"] as! [String: Any]; message["chatId"] = "789@lid"; item["message"] = message; return item },
      { var item = $0; item["identityState"] = "pendingLid"; return item },
      { var item = $0; item["deliveryId"] = (item["deliveryId"] as! String) + "\n"; return item },
      { var item = $0; item["deliveryId"] = (item["deliveryId"] as! String) + "\r\n"; return item },
      { var item = $0; item["createdOrdinal"] = 4_294_967_296; return item },
      { var item = $0; item["createdRevision"] = "01"; return item },
      { var item = $0; var recovery = item["recovery"] as! [String: Any]; recovery["items"] = [["format": "v2", "plaintextBase64": "AQ==", "ciphertextHashBase64": "AQ=="]]; item["recovery"] = recovery; return item },
      { var item = $0; var recovery = item["recovery"] as! [String: Any]; recovery["items"] = [["format": "v2", "plaintextBase64": "AQ", "ciphertextHashBase64": Data(repeating: 0, count: 32).base64EncodedString()]]; item["recovery"] = recovery; return item },
      { var item = $0; var recovery = item["recovery"] as! [String: Any]; recovery["items"] = [["format": "v2", "plaintextBase64": "AR==", "ciphertextHashBase64": Data(repeating: 0, count: 32).base64EncodedString()]]; item["recovery"] = recovery; return item },
      { var item = $0; var recovery = item["recovery"] as! [String: Any]; recovery["items"] = [["format": "history", "plaintextBase64": "AQ=="]]; item["recovery"] = recovery; return item },
    ]
    for mutate in bad {
      XCTAssertThrowsError(try store.commit(expectedRevision: "1") { current in
        var next = current; next["pending"] = [mutate(pending())]; return next
      })
    }
    XCTAssertThrowsError(try store.commit(expectedRevision: "1") { current in
      var next = current
      var duplicate = pending(); duplicate["deliveryId"] = "wa-delivery:v1:" + String(repeating: "b", count: 32)
      next["pending"] = [pending(), duplicate]
      return next
    })
  }

  func testInterruptedRetirementCompletesBeforeAnotherSession() throws {
    for phase in ["retiredPublished", "deleteSessionKey", "keyDeleted"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var active = false
      let writer = try makeStore(root) { if active && $0 == phase { throw StateStoreError.storage } }
      _ = try writer.open()
      try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
      active = true
      XCTAssertThrowsError(try writer.endSession())
      let recovered = try makeStore(root)
      let state = try recovered.open()
      XCTAssertTrue(state["session"] is NSNull)
      XCTAssertEqual((state["sessionKeysToDelete"] as? [String])?.count, 0)
      let published = try makeStore(root).open()
      XCTAssertEqual(try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
                     try JSONSerialization.data(withJSONObject: published, options: [.sortedKeys]))
      try recovered.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    }
  }

  func testRealFilesystemFailureCannotReplacePublishedState() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try makeStore(root).open()
    // The file system refuses the write (a read-only database file): nothing is published.
    try FileManager.default.setAttributes([.posixPermissions: 0o400], ofItemAtPath: stateFile(root).path)
    XCTAssertThrowsError(try makeStore(root).commit(expectedRevision: "0") { current in
      var next = current; next["options"] = ["maxRecoveryBufferBytes": 10 * 1024 * 1024, "maxImageStorageBytes": 123]; return next
    })
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateFile(root).path)
    XCTAssertEqual(try revision(root), "0")
    let options = try XCTUnwrap(makeStore(root).open()["options"] as? [String: Int])
    XCTAssertEqual(options["maxImageStorageBytes"], 50 * 1024 * 1024)
  }

  func testActualENOSPCOnBoundedVolume() throws {
    let volume = URL(fileURLWithPath: "/Volumes/wa02-whatsapp-enospc", isDirectory: true)
    let manager = FileManager.default
    let volumeDevice = try XCTUnwrap(manager.attributesOfFileSystem(forPath: volume.path)[.systemNumber] as? NSNumber)
    let hostDevice = try XCTUnwrap(manager.attributesOfFileSystem(forPath: manager.temporaryDirectory.path)[.systemNumber] as? NSNumber)
    let capacity = try XCTUnwrap(manager.attributesOfFileSystem(forPath: volume.path)[.systemSize] as? NSNumber).int64Value
    guard volumeDevice != hostDevice, capacity > 32 * 1024 * 1024,
          capacity <= 300 * 1024 * 1024 else { XCTFail("Test requires a separate bounded filesystem"); return }
    let root = volume.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let filler = volume.appendingPathComponent("filler")
    let probe = volume.appendingPathComponent("probe")
    defer { try? manager.removeItem(at: root); try? manager.removeItem(at: filler); try? manager.removeItem(at: probe) }
    let store = try makeStore(root)
    _ = try store.open()
    let messageInfoJson = "{\"padding\":\"" + String(repeating: "A", count: 8 * 1024 * 1024) + "\"}"
    let recovery: [String: Any] = ["messageInfoJson": messageInfoJson, "items": [Any]()]
    let pending: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32),
                                  "accountId": "123@lid", "createdRevision": "1", "createdOrdinal": 0,
                                  "source": "live", "identityState": "pendingLid",
                                  "recovery": recovery]
    _ = try store.commit(expectedRevision: "0") { current in
      var next = current
      next["options"] = ["maxRecoveryBufferBytes": 20 * 1024 * 1024,
                         "maxImageStorageBytes": 50 * 1024 * 1024]
      next["pending"] = [pending]
      return next
    }
    let preflight = try makeStore(root).open()
    guard (preflight["pending"] as? [[String: Any]])?.count == 1 else {
      XCTFail("Mounted volume could not reopen the published state"); return
    }
    let published = stateFile(root)
    let publishedSize = try XCTUnwrap(manager.attributesOfItem(atPath: published.path)[.size] as? NSNumber).intValue
    let protection = try published.resourceValues(forKeys: [.fileProtectionKey]).fileProtection
    guard protection == .completeUntilFirstUserAuthentication else {
      XCTFail("Mounted volume did not preserve file protection"); return
    }
    func freeBytes() throws -> Int64 {
      try XCTUnwrap(manager.attributesOfFileSystem(forPath: volume.path)[.systemFreeSize] as? NSNumber).int64Value
    }
    guard try freeBytes() > Int64(publishedSize * 2) else { XCTFail("Not enough bounded volume space for the second-copy test"); return }
    XCTAssertTrue(manager.createFile(atPath: filler.path, contents: nil))
    let fillHandle = try FileHandle(forWritingTo: filler)
    defer { try? fillHandle.close() }
    let block = Data(repeating: 0x5a, count: 1024 * 1024)
    while true {
      let available = try freeBytes()
      if available <= Int64(publishedSize / 2) { break }
      let count = Int(min(Int64(block.count), available - Int64(publishedSize / 2)))
      do { try fillHandle.write(contentsOf: block.prefix(count)) }
      catch { guard isNoSpace(error) else { throw error }; break }
    }
    XCTAssertTrue(manager.createFile(atPath: probe.path, contents: nil))
    let probeHandle = try FileHandle(forWritingTo: probe)
    defer { try? probeHandle.close() }
    var exhausted = false
    do { try probeHandle.write(contentsOf: Data(repeating: 0, count: publishedSize)) }
    catch { exhausted = isNoSpace(error); if !exhausted { throw error } }
    XCTAssertTrue(exhausted, "Expected a real ENOSPC from the bounded filesystem")
    // A second 8 MiB entry needs more room than is left: the transaction rolls back.
    var second = pending
    second["deliveryId"] = "wa-delivery:v1:" + String(repeating: "b", count: 32)
    second["createdRevision"] = "2"
    XCTAssertThrowsError(try makeStore(root).commit(expectedRevision: "1") { current in
      var next = current; next["pending"] = [pending, second]; return next
    })
    XCTAssertEqual(try revision(root), "1")
    try? probeHandle.close()
    try? fillHandle.close()
    try manager.removeItem(at: probe)
    try manager.removeItem(at: filler)
    XCTAssertEqual((try makeStore(root).open()["pending"] as? [[String: Any]])?.count, 1)
  }

  private func isNoSpace(_ error: Error) -> Bool {
    let value = error as NSError
    if value.domain == NSPOSIXErrorDomain && value.code == Int(ENOSPC) { return true }
    if value.domain == NSCocoaErrorDomain && value.code == CocoaError.fileWriteOutOfSpace.rawValue { return true }
    if let underlying = value.userInfo[NSUnderlyingErrorKey] as? Error { return isNoSpace(underlying) }
    return false
  }

  func testStaleRevisionCannotReplacePublishedState() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    _ = try store.commit(expectedRevision: "0") { $0 }
    XCTAssertThrowsError(try store.commit(expectedRevision: "0") { $0 })
    XCTAssertNoThrow(try makeStore(root).open())
  }

  func testRevisionsAndAccountIdsRequireCanonicalForms() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    for revision in ["", "00", "01", "-1", "+1", "1.0", "0\n", "18446744073709551616", "999999999999999999999999"] {
      XCTAssertThrowsError(try store.commit(expectedRevision: revision) { $0 })
    }
    for account in ["", "123@s.whatsapp.net", "123:1@lid", "abc@lid", "123@lid/other", "123@lid\n", "123@lid\r\n"] {
      XCTAssertThrowsError(try store.beginSession(accountId: account, protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8)))
    }
    XCTAssertThrowsError(try NativeStateStore(directory: root, serviceSuffix: String(repeating: "a", count: 32) + "\n"))
  }

  func testExhaustedRevisionCannotCreateAProvisionalKey() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try makeStore(root).open()
    try sql(root, "UPDATE meta SET revision = ?", ["18446744073709551615"])
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let recordBytes = try keychainData(root, id: "record")
    func accounts() throws -> Set<String> {
      let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                  kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll,
                                  kSecUseDataProtectionKeychain as String: true]
      var result: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let values = result as? [[String: Any]] else { throw StateStoreError.storage }
      return Set(values.compactMap { $0[kSecAttrAccount as String] as? String })
    }
    let before = try accounts()
    let restored = try makeStore(root)
    _ = try restored.open()
    XCTAssertThrowsError(try restored.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))) { error in
      if case StateStoreError.invalid = error {} else { XCTFail("Expected revision exhaustion") }
    }
    XCTAssertEqual(try accounts(), before)
    XCTAssertEqual(try keychainData(root, id: "record"), recordBytes)
  }

  func testExactlySixteenMiBSerializedSessionRestores() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    let template: [String: Any] = ["accountId": "1@lid", "sessionKeyId": String(repeating: "a", count: 32),
                                   "sessionRevision": "1", "nonceBase64": String(repeating: "A", count: 16), "ciphertextBase64": ""]
    let overhead = try JSONSerialization.data(withJSONObject: template, options: [.sortedKeys]).count
    let encoded = 16 * 1024 * 1024 - overhead
    XCTAssertEqual(encoded % 4, 0)
    let prefix = "{\"protocolSchemaVersion\":1,\"records\":[\""
    let suffix = "\"]}"
    let padding = encoded / 4 * 3 - 16 - prefix.utf8.count - suffix.utf8.count
    let protocolBytes = Data((prefix + String(repeating: "A", count: padding) + suffix).utf8)
    try store.beginSession(accountId: "1@lid", protocolBytes: protocolBytes)
    let session = try XCTUnwrap(store.open()["session"])
    XCTAssertEqual(try JSONSerialization.data(withJSONObject: session, options: [.sortedKeys, .withoutEscapingSlashes]).count, 16 * 1024 * 1024)
    let restored = try makeStore(root)
    let restoredSession = try XCTUnwrap(restored.open()["session"] as? [String: Any])
    XCTAssertEqual(try JSONSerialization.data(withJSONObject: restoredSession, options: [.sortedKeys, .withoutEscapingSlashes]).count, 16 * 1024 * 1024)
    XCTAssertEqual(restoredSession["ciphertextBase64"] as? String, (session as? [String: Any])?["ciphertextBase64"] as? String)
    XCTAssertTrue(try restored.canRestoreSession())
  }

  func testOversizedSessionCannotPublishOrPruneState() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    XCTAssertThrowsError(try store.beginSession(accountId: "123@lid", protocolBytes: Data(repeating: 0, count: 16 * 1024 * 1024 + 1)))
    XCTAssertTrue(try makeStore(root).open()["session"] is NSNull)
    func session(_ ciphertextSize: Int) -> [String: Any] {
      ["accountId": "1@lid", "sessionKeyId": String(repeating: "a", count: 32), "sessionRevision": "1",
       "nonceBase64": "AAAAAAAAAAAAAAAA", "ciphertextBase64": String(repeating: "A", count: ciphertextSize)]
    }
    let overhead = try JSONSerialization.data(withJSONObject: session(0), options: [.sortedKeys]).count
    let exactSize = 16 * 1024 * 1024 - overhead
    XCTAssertEqual(exactSize % 4, 0)
    XCTAssertEqual(try JSONSerialization.data(withJSONObject: session(exactSize), options: [.sortedKeys]).count, 16 * 1024 * 1024)
    XCTAssertThrowsError(try store.commit(expectedRevision: "0") { current in
      var next = current; next["session"] = session(exactSize); return next
    }) { error in
      if case StateStoreError.sessionLimit = error { XCTFail("Exact boundary must pass the size check") }
    }
    XCTAssertThrowsError(try store.commit(expectedRevision: "0") { current in
      var next = current; next["session"] = session(exactSize + 4); return next
    }) { error in
      if case StateStoreError.sessionLimit = error {} else { XCTFail("Expected session size limit") }
    }
  }

  func testOversizedRestoredSessionStillAllowsPendingToDrain() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try makeStore(root).open()
    let session: [String: Any] = ["accountId": "123@lid", "sessionKeyId": String(repeating: "a", count: 32),
                                  "sessionRevision": "0", "nonceBase64": "AAAAAAAAAAAAAAAA",
                                  "ciphertextBase64": String(repeating: "A", count: 16 * 1024 * 1024)]
    let pending: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "c", count: 32),
                                  "accountId": "123@lid", "createdRevision": "0", "createdOrdinal": 0,
                                  "source": "live", "identityState": "pendingLid",
                                  "recovery": ["messageInfoJson": "{}", "items": [[String: Any]]()]]
    try sql(root, "INSERT INTO session (id, value) VALUES (1, ?)", [try JSONSerialization.data(withJSONObject: session, options: [.sortedKeys])])
    try insertSealedPending(root, pending)
    let restored = try makeStore(root)
    XCTAssertEqual((try restored.open()["pending"] as? [[String: Any]])?.count, 1)
    XCTAssertFalse(try restored.canRestoreSession())
    XCTAssertThrowsError(try restored.commit(expectedRevision: "0") { current in
      var next = current; var changed = next["session"] as! [String: Any]
      changed["ciphertextBase64"] = String(repeating: "B", count: 16 * 1024 * 1024)
      next["session"] = changed; return next
    })
    XCTAssertEqual((try restored.open()["session"] as? [String: Any])?["ciphertextBase64"] as? String,
                   session["ciphertextBase64"] as? String)
    _ = try restored.commit(expectedRevision: "0") { current in
      var next = current; next["pending"] = [[String: Any]](); return next
    }
    XCTAssertEqual((try makeStore(root).open()["pending"] as? [[String: Any]])?.count, 0)
  }

  func testConcurrentStoreInstancesCannotOverwriteAnOlderSnapshot() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let first = try makeStore(root)
    let second = try makeStore(root)
    _ = try first.open(); _ = try second.open()
    _ = try first.commit(expectedRevision: "0") { state in
      var next = state
      next["options"] = ["maxRecoveryBufferBytes": 10 * 1024 * 1024, "maxImageStorageBytes": 123]
      return next
    }
    XCTAssertThrowsError(try second.commit(expectedRevision: "0") { $0 })
    _ = try second.commit(expectedRevision: "1") { state in
      var next = state
      next["options"] = ["maxRecoveryBufferBytes": 456, "maxImageStorageBytes": 123]
      return next
    }
    let options = try XCTUnwrap(makeStore(root).open()["options"] as? [String: Int])
    XCTAssertEqual(options["maxImageStorageBytes"], 123)
    XCTAssertEqual(options["maxRecoveryBufferBytes"], 456)
  }

  func testCorruptionNeverBecomesEmptyInstall() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try makeStore(root).open()
    var data = try Data(contentsOf: stateFile(root))
    data.replaceSubrange(0..<16, with: Data(count: 16))
    try data.write(to: stateFile(root))
    XCTAssertThrowsError(try makeStore(root).open())
    XCTAssertEqual(try Data(contentsOf: stateFile(root)), data)
  }

  func testEstablishedStateNeverRegeneratesMissingFileOrKeychainRecord() throws {
    let missingFile = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingFile) }
    _ = try makeStore(missingFile).open()
    try FileManager.default.removeItem(at: stateFile(missingFile))
    XCTAssertThrowsError(try makeStore(missingFile).open())

    let missingRecord = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingRecord) }
    _ = try makeStore(missingRecord).open()
    let service = "com.yoyos.whatsapp.state.test." + missingRecord.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "record", kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(query as CFDictionary), errSecSuccess)
    try FileManager.default.removeItem(at: stateFile(missingRecord))
    XCTAssertThrowsError(try makeStore(missingRecord).open())

    let missingKey = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingKey) }
    _ = try makeStore(missingKey).open()
    let recoveryId = try XCTUnwrap((try creationRecord(missingKey))["recoveryKeyId"] as? String)
    let keyService = "com.yoyos.whatsapp.state.test." + missingKey.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let keyQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keyService,
                                   kSecAttrAccount as String: recoveryId, kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(keyQuery as CFDictionary), errSecSuccess)
    XCTAssertThrowsError(try makeStore(missingKey).open())
  }

  func testTamperedRowsNeverLoadOrCreateEmptyState() throws {
    var entry = pendingEntry("a", ordinal: 0)
    entry["createdRevision"] = "1"
    let tampering: [(URL) throws -> Void] = [
      { try self.sql($0, "DELETE FROM meta") },
      { try self.sql($0, "UPDATE meta SET store_id = ?", [String(repeating: "0", count: 32)]) },
      { try self.sql($0, "UPDATE meta SET revision = '01'") },
      { try self.sql($0, "UPDATE meta SET control = ?", [Data("{\"unexpected\":true}".utf8)]) },
      { try self.sql($0, "UPDATE pending SET created_ordinal = 1") },
      { try self.sql($0, "UPDATE pending SET delivery_id = ?", ["wa-delivery:v1:" + String(repeating: "b", count: 32)]) },
      { try self.sql($0, "UPDATE pending SET ciphertext = substr(ciphertext, 2) || x'00'") },
      { try self.sql($0, "INSERT INTO session (id, value) VALUES (1, ?)", [Data("not json".utf8)]) },
    ]
    for tamper in tampering {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      _ = try makeStore(root).commit(expectedRevision: "0") { current in
        var next = current; next["pending"] = [entry]; return next
      }
      try tamper(root)
      XCTAssertThrowsError(try makeStore(root).open())
      XCTAssertTrue(FileManager.default.fileExists(atPath: stateFile(root).path))
    }
  }

  func testInvalidStateDoesNotAdvancePublishedRevision() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    let invalid: [([String: Any]) -> [String: Any]] = [
      { var state = $0; state["options"] = ["maxRecoveryBufferBytes": 0, "maxImageStorageBytes": 1]; return state },
      { var state = $0; state["options"] = ["maxRecoveryBufferBytes": 1.5, "maxImageStorageBytes": 1]; return state },
      { var state = $0; state["options"] = ["maxRecoveryBufferBytes": "100", "maxImageStorageBytes": 1]; return state },
      { var state = $0; state["options"] = ["maxRecoveryBufferBytes": 9_007_199_254_740_992, "maxImageStorageBytes": 1]; return state },
      { var state = $0; state["unexpected"] = true; return state },
      { var state = $0; state["pending"] = [["deliveryId": "wrong"]]; return state },
    ]
    for mutate in invalid {
      XCTAssertThrowsError(try store.commit(expectedRevision: "0", change: mutate))
      XCTAssertEqual(try revision(root), "0")
      XCTAssertNoThrow(try makeStore(root).open())
    }
  }

  func testProtocolCallbackUsesRegisteredGenerationAndDurableRevision() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    try writer.registerFreshGeneration("generation")
    func response(_ raw: String) throws -> [String: Any] {
      try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    }
    func b64(_ value: Data) -> String { value.base64EncodedString() }
    let account = Data([10, 2, 8, 1, 18, 32]) + Data(repeating: 1, count: 32) +
      Data([26, 64]) + Data(repeating: 1, count: 64) + Data([34, 64]) + Data(repeating: 1, count: 64)
    let value = "{\"version\":1,\"noisePrivateKey\":\"\(b64(Data(repeating: 1, count: 32)))\",\"identityPrivateKey\":\"\(b64(Data(repeating: 2, count: 32)))\",\"signedPreKeyPrivate\":\"\(b64(Data(repeating: 3, count: 32)))\",\"signedPreKeyId\":7,\"signedPreKeySignature\":\"\(b64(Data(repeating: 4, count: 64)))\",\"registrationId\":9,\"advSecretKey\":\"\(b64(Data(repeating: 1, count: 32)))\",\"id\":\"123:2@s.whatsapp.net\",\"lid\":\"123:2@lid\",\"account\":\"\(b64(account))\",\"platform\":\"\",\"businessName\":\"\",\"pushName\":\"\",\"facebookUuid\":\"\",\"lidMigrationTimestamp\":0,\"companionMetaNonce\":\"\"}"
    let first = "{\"contractVersion\":1,\"generationId\":\"generation\",\"accountId\":\"123@lid\",\"device\":{\"recordType\":\"device\",\"recordKey\":\"W10\",\"valueBase64\":\"\(b64(Data(value.utf8)))\"}}"
    XCTAssertEqual(try response(writer.beginFreshProtocolSession(first))["success"] as? Bool, true)
    let prekeyState = Data("{\"version\":1,\"nextId\":1,\"uploadedThrough\":0}".utf8).base64EncodedString()
    func request(_ generation: String, _ expected: String) throws -> String {
      let body: [String: Any] = ["contractVersion": 1, "generationId": generation, "accountId": "123@lid",
        "expectedSessionRevision": expected, "protocolChanges": [["operation": "put", "recordType": "prekey-state",
          "recordKey": "W10", "valueBase64": prekeyState]], "pendingInserts": [Any](), "pendingIdentityUpdates": [Any]()]
      return try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: body), encoding: .utf8))
    }
    XCTAssertEqual(try response(writer.applyProtocolChanges(request("other", "1")))["success"] as? Bool, false)
    XCTAssertEqual(try response(writer.applyProtocolChanges(request("generation", "0")))["success"] as? Bool, false)
    XCTAssertEqual(try response(writer.applyProtocolChanges(request("generation", "1")))["success"] as? Bool, true)
    let disk = try makeStore(root)
    let read = try response(disk.readProtocolState("{\"contractVersion\":1}"))
    let data = try XCTUnwrap(read["data"] as? [String: Any])
    let session = try XCTUnwrap(data["session"] as? [String: Any])
    XCTAssertEqual((session["records"] as? [[String: Any]])?.count, 2)
    XCTAssertEqual(data["sessionRevision"] as? String, "2")
    let invalidPrekey: [String: Any] = ["operation": "put", "recordType": "prekey", "recordKey": "WyIwMSJd",
      "valueBase64": "eyJ2ZXJzaW9uIjoxfQ=="]
    let invalidRequest: [String: Any] = ["contractVersion": 1, "generationId": "generation", "accountId": "123@lid",
      "expectedSessionRevision": "2", "protocolChanges": [invalidPrekey], "pendingInserts": [Any](), "pendingIdentityUpdates": [Any]()]
    let invalidRaw = try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: invalidRequest), encoding: .utf8))
    XCTAssertEqual(try response(writer.applyProtocolChanges(invalidRaw))["success"] as? Bool, false)
    XCTAssertEqual(try revision(root), "2")
    let whitespaceTuple = "WyAiMTIzOjIiIF0"
    let noncanonical: [String: Any] = ["contractVersion": 1, "generationId": "generation", "accountId": "123@lid",
      "expectedSessionRevision": "2", "protocolChanges": [["operation": "put", "recordType": "signal-session",
        "recordKey": whitespaceTuple, "valueBase64": "eyJ2ZXJzaW9uIjoxLCJkYXRhIjoiQVE9PSJ9"]],
      "pendingInserts": [Any](), "pendingIdentityUpdates": [Any]()]
    let noncanonicalRaw = try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: noncanonical), encoding: .utf8))
    XCTAssertEqual(try response(writer.applyProtocolChanges(noncanonicalRaw))["success"] as? Bool, false)
    writer.retireGeneration()
    XCTAssertEqual(try response(writer.applyProtocolChanges(request("generation", "2")))["success"] as? Bool, false)
  }

  func testFreshProtocolRejectsIncompleteDeviceWithoutPublishing() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    try writer.registerFreshGeneration("fresh-generation")
    let request = #"{"contractVersion":1,"generationId":"fresh-generation","accountId":"123@lid","device":{"recordType":"device","recordKey":"W10","valueBase64":"eyJ2ZXJzaW9uIjoxLCJpZCI6IjEyMzoyQHMud2hhdHNhcHAubmV0IiwibGlkIjoiMTIzQGxpZCJ9"}}"#
    let response = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(writer.beginFreshProtocolSession(request).utf8)) as? [String: Any])
    XCTAssertEqual(response["success"] as? Bool, false)
    XCTAssertTrue(try writer.open()["session"] is NSNull)
  }

  func testOptionsUpdateUsesCurrentWriterRevisionWithoutSession() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    XCTAssertEqual(try writer.updateOptions(maxRecoveryBufferBytes: 12 * 1024 * 1024, maxImageStorageBytes: 60 * 1024 * 1024), "1")
    XCTAssertEqual(try writer.updateOptions(maxRecoveryBufferBytes: 12 * 1024 * 1024, maxImageStorageBytes: 60 * 1024 * 1024), "1")
    let reopened = try makeStore(root).open()
    let options = try XCTUnwrap(reopened["options"] as? [String: Any])
    XCTAssertEqual(options["maxRecoveryBufferBytes"] as? Int, 12 * 1024 * 1024)
  }

  // IT-CFG-07 (Go reads with this bound): reducing the budget never reduces the read bound that is handed
  // to Go, and it survives a restart, so the snapshot holding the excess stays decodable while it drains.
  func testRecoveryReadBoundSurvivesReductionAndRestart() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    XCTAssertEqual(try writer.recoveryReadBound(), 10 * 1024 * 1024)
    _ = try writer.updateOptions(maxRecoveryBufferBytes: 12 * 1024 * 1024, maxImageStorageBytes: 60 * 1024 * 1024)
    XCTAssertEqual(try writer.recoveryReadBound(), 12 * 1024 * 1024)
    _ = try writer.updateOptions(maxRecoveryBufferBytes: 1024, maxImageStorageBytes: 60 * 1024 * 1024)
    XCTAssertEqual(((try makeStore(root).open())["options"] as? [String: Any])?["maxRecoveryBufferBytes"] as? Int, 1024)
    XCTAssertEqual(try writer.recoveryReadBound(), 12 * 1024 * 1024)
    XCTAssertEqual(try makeStore(root).recoveryReadBound(), 12 * 1024 * 1024)
  }

  private func pendingEntry(_ letter: String, ordinal: Int) -> [String: Any] {
    ["deliveryId": "wa-delivery:v1:" + String(repeating: letter, count: 32), "accountId": "123@lid",
     "createdRevision": "2", "createdOrdinal": ordinal, "source": "live", "identityState": "pendingLid",
     "recovery": ["messageInfoJson": "{}", "items": [[String: Any]]()]]
  }

  private func response(_ text: String) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
  }

  // M1 / IT-CFG-06 / IT-CFG-07: with a reduced budget already exceeded, only insertions are refused;
  // identity resolution and protocol-only publications still go through so the excess can drain.
  func testReducedBudgetRefusesOnlyInsertions() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try protocolWriter(root)
    let padding = "{\"padding\":\"" + String(repeating: "A", count: 2000) + "\"}"
    func padded(_ letter: String, _ ordinal: Int) -> [String: Any] {
      var entry = pendingEntry(letter, ordinal: ordinal)
      entry["recovery"] = ["messageInfoJson": padding, "items": [[String: Any]]()]
      return entry
    }
    _ = try writer.commit(expectedRevision: "1") { current in
      var next = current
      next["pending"] = [padded("a", 0), padded("b", 1)]
      return next
    }
    _ = try writer.updateOptions(maxRecoveryBufferBytes: 1024, maxImageStorageBytes: 50 * 1024 * 1024) // far below the ~4 KB stored
    let sessionRevision = try XCTUnwrap((writer.open()["session"] as? [String: Any])?["sessionRevision"] as? String)
    func request(inserts: [[String: Any]], updates: [[String: Any]]) throws -> String {
      let body: [String: Any] = ["contractVersion": 1, "generationId": "generation", "accountId": "123@lid",
        "expectedSessionRevision": sessionRevision, "protocolChanges": [[String: Any]](),
        "pendingInserts": inserts, "pendingIdentityUpdates": updates]
      return try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: body), encoding: .utf8))
    }
    let insert = try response(writer.applyProtocolChanges(request(inserts: [insertable(padded("c", 0))], updates: [])))
    XCTAssertEqual(insert["success"] as? Bool, false)
    XCTAssertEqual((insert["error"] as? [String: Any])?["code"] as? String, "BUFFER_FULL")
    let update: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32), "identityState": "resolved",
                                 "message": resolvedMessage()]
    XCTAssertEqual(try response(writer.applyProtocolChanges(request(inserts: [], updates: [update])))["success"] as? Bool, true)
    let pending = try XCTUnwrap(try writer.open()["pending"] as? [[String: Any]])
    XCTAssertEqual(pending.count, 2) // nothing was discarded
    XCTAssertEqual(pending[0]["identityState"] as? String, "resolved")
  }

  // IT-DEL-07 / IT-DEL-08 / IT-DEL-11: durable idempotent retirement, no session key or generation needed.
  func testRetirePendingIsDurableIdempotentAndNeedsNoSessionKey() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    try writer.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let keyId = try XCTUnwrap((writer.open()["session"] as? [String: Any])?["sessionKeyId"] as? String)
    _ = try writer.commit(expectedRevision: "1") { current in
      var next = current
      next["pending"] = [pendingEntry("a", ordinal: 0), pendingEntry("b", ordinal: 1)]
      return next
    }
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: keyId, kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(query as CFDictionary), errSecSuccess)
    let recovered = try makeStore(root) // session unusable, buffer intact
    let read = try response(recovered.readPending("{\"contractVersion\":1}"))
    XCTAssertEqual(read["success"] as? Bool, true)
    XCTAssertEqual(((read["data"] as? [String: Any])?["pending"] as? [[String: Any]])?.count, 2)
    let request = "{\"contractVersion\":1,\"deliveryId\":\"wa-delivery:v1:" + String(repeating: "a", count: 32) + "\"}"
    let first = try XCTUnwrap(try response(recovered.retirePending(request))["data"] as? [String: Any])
    XCTAssertEqual(first["removed"] as? Bool, true)
    let again = try XCTUnwrap(try response(recovered.retirePending(request))["data"] as? [String: Any])
    XCTAssertEqual(again["removed"] as? Bool, false) // a lost reply is repeatable
    XCTAssertEqual(again["revision"] as? String, first["revision"] as? String) // and publishes nothing
    let remaining = try XCTUnwrap(try makeStore(root).open()["pending"] as? [[String: Any]])
    XCTAssertEqual(remaining.count, 1)
    XCTAssertEqual(remaining[0]["deliveryId"] as? String, "wa-delivery:v1:" + String(repeating: "b", count: 32))
  }

  func testRetirePendingRejectsMalformedRequestsWithoutMutation() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    let id = "wa-delivery:v1:" + String(repeating: "a", count: 32)
    for bad in ["{\"contractVersion\":1,\"deliveryId\":\"nope\"}", "{\"contractVersion\":2,\"deliveryId\":\"" + id + "\"}",
                "{\"contractVersion\":1}", "{\"contractVersion\":1,\"deliveryId\":\"" + id + "\",\"extra\":1}"] {
      let result = try response(writer.retirePending(bad))
      XCTAssertEqual(result["success"] as? Bool, false)
      XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "INVALID_REQUEST")
    }
    XCTAssertEqual(try response(writer.readPending("{\"contractVersion\":2}"))["success"] as? Bool, false)
  }

  private func freshSessionRequest(_ generation: String) -> String {
    func b64(_ value: Data) -> String { value.base64EncodedString() }
    let account = Data([10, 2, 8, 1, 18, 32]) + Data(repeating: 1, count: 32) +
      Data([26, 64]) + Data(repeating: 1, count: 64) + Data([34, 64]) + Data(repeating: 1, count: 64)
    let value = "{\"version\":1,\"noisePrivateKey\":\"\(b64(Data(repeating: 1, count: 32)))\",\"identityPrivateKey\":\"\(b64(Data(repeating: 2, count: 32)))\",\"signedPreKeyPrivate\":\"\(b64(Data(repeating: 3, count: 32)))\",\"signedPreKeyId\":7,\"signedPreKeySignature\":\"\(b64(Data(repeating: 4, count: 64)))\",\"registrationId\":9,\"advSecretKey\":\"\(b64(Data(repeating: 1, count: 32)))\",\"id\":\"123:2@s.whatsapp.net\",\"lid\":\"123:2@lid\",\"account\":\"\(b64(account))\",\"platform\":\"\",\"businessName\":\"\",\"pushName\":\"\",\"facebookUuid\":\"\",\"lidMigrationTimestamp\":0,\"companionMetaNonce\":\"\"}"
    return "{\"contractVersion\":1,\"generationId\":\"\(generation)\",\"accountId\":\"123@lid\",\"device\":{\"recordType\":\"device\",\"recordKey\":\"W10\",\"valueBase64\":\"\(b64(Data(value.utf8)))\"}}"
  }

  /// A writer with a session and a registered generation, ready for Go's protocol callbacks.
  private func protocolWriter(_ root: URL, fault: ((String) throws -> Void)? = nil) throws -> NativeStateStore {
    let writer = try makeStore(root, fault: fault)
    _ = try writer.open()
    try writer.registerFreshGeneration("generation")
    XCTAssertEqual(try response(writer.beginFreshProtocolSession(freshSessionRequest("generation")))["success"] as? Bool, true)
    return writer
  }

  private func resolvedMessage() -> [String: Any] {
    let encoded = Data("[\"123@lid\",\"456@lid\",\"ABC\"]".utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    return ["id": "wa-message:v1:" + encoded, "accountId": "123@lid", "whatsappMessageId": "ABC", "chatId": "456@lid", "direction": "incoming"]
  }

  private func insertable(_ entry: [String: Any]) -> [String: Any] {
    var item = entry
    item.removeValue(forKey: "createdRevision")
    item.removeValue(forKey: "createdOrdinal")
    return item
  }

  private func applyRequest(_ expected: String, inserts: [[String: Any]], updates: [[String: Any]] = [], changes: [[String: Any]] = []) throws -> String {
    let body: [String: Any] = ["contractVersion": 1, "generationId": "generation", "accountId": "123@lid",
                               "expectedSessionRevision": expected, "protocolChanges": changes,
                               "pendingInserts": inserts, "pendingIdentityUpdates": updates]
    return try XCTUnwrap(String(data: JSONSerialization.data(withJSONObject: body), encoding: .utf8))
  }

  private func retireRequest(_ letter: String) -> String {
    "{\"contractVersion\":1,\"deliveryId\":\"wa-delivery:v1:" + String(repeating: letter, count: 32) + "\"}"
  }

  // Confirming deletes one row: the stored session bytes and sessionRevision stay as they were.
  func testRetirePendingLeavesTheStoredSessionUntouched() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try protocolWriter(root)
    let inserts = [insertable(pendingEntry("a", ordinal: 0)), insertable(pendingEntry("b", ordinal: 0))]
    XCTAssertEqual(try response(writer.applyProtocolChanges(applyRequest("1", inserts: inserts)))["success"] as? Bool, true)
    let session = try sessionValue(root)
    let retired = try XCTUnwrap(try response(writer.retirePending(retireRequest("a")))["data"] as? [String: Any])
    XCTAssertEqual(retired["removed"] as? Bool, true)
    XCTAssertEqual(try sessionValue(root), session)
    XCTAssertEqual(try revision(root), "3")
    let restored = try makeStore(root).open()
    XCTAssertEqual((restored["session"] as? [String: Any])?["sessionRevision"] as? String, "1")
    XCTAssertEqual((restored["pending"] as? [[String: Any]])?.compactMap { $0["deliveryId"] as? String },
                   ["wa-delivery:v1:" + String(repeating: "b", count: 32)])
  }

  // The inserts and the session publish together: a failure before the commit leaves neither.
  func testFailedApplyPublishesNeitherPendingNorSession() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    var active = false
    let writer = try protocolWriter(root) { if active && $0 == "beforeCommit" { throw StateStoreError.storage } }
    let prekeyState = Data("{\"version\":1,\"nextId\":1,\"uploadedThrough\":0}".utf8).base64EncodedString()
    let request = try applyRequest("1", inserts: [insertable(pendingEntry("a", ordinal: 0))],
                                   changes: [["operation": "put", "recordType": "prekey-state", "recordKey": "W10", "valueBase64": prekeyState]])
    active = true
    XCTAssertEqual(try response(writer.applyProtocolChanges(request))["success"] as? Bool, false)
    active = false
    XCTAssertEqual(try revision(root), "1")
    let restored = try makeStore(root).open()
    XCTAssertEqual((restored["pending"] as? [[String: Any]])?.count, 0)
    XCTAssertEqual((restored["session"] as? [String: Any])?["sessionRevision"] as? String, "1")
    XCTAssertEqual(try response(writer.applyProtocolChanges(request))["success"] as? Bool, true)
    XCTAssertEqual((try makeStore(root).open()["pending"] as? [[String: Any]])?.count, 1)
  }

  // An identity update never recreates an entry that was already confirmed.
  func testIdentityUpdateCannotRecreateARetiredEntry() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try protocolWriter(root)
    XCTAssertEqual(try response(writer.applyProtocolChanges(applyRequest("1", inserts: [insertable(pendingEntry("a", ordinal: 0))])))["success"] as? Bool, true)
    _ = writer.retirePending(retireRequest("a"))
    let update: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "a", count: 32), "identityState": "resolved", "message": resolvedMessage()]
    XCTAssertEqual(try response(writer.applyProtocolChanges(applyRequest("1", inserts: [], updates: [update])))["success"] as? Bool, false)
    XCTAssertEqual((try makeStore(root).open()["pending"] as? [[String: Any]])?.count, 0)
  }

  // A second instance sees a confirmation made by the first without keeping a stale copy.
  func testAnotherInstanceSeesARetirement() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try protocolWriter(root)
    let inserts = [insertable(pendingEntry("a", ordinal: 0)), insertable(pendingEntry("b", ordinal: 0))]
    XCTAssertEqual(try response(writer.applyProtocolChanges(applyRequest("1", inserts: inserts)))["success"] as? Bool, true)
    let reader = try makeStore(root)
    func count() throws -> Int? { ((try response(reader.readPending("{\"contractVersion\":1}"))["data"] as? [String: Any])?["pending"] as? [[String: Any]])?.count }
    XCTAssertEqual(try count(), 2)
    _ = writer.retirePending(retireRequest("a"))
    XCTAssertEqual(try count(), 1)
  }
}
