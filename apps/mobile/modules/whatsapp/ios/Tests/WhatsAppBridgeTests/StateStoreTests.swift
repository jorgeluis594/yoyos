import XCTest
import Foundation
import Security
@testable import WhatsAppStateStore

final class StateStoreTests: XCTestCase {
  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func makeStore(_ root: URL, fault: ((String) throws -> Void)? = nil) throws -> NativeStateStore {
    try NativeStateStore(directory: root, serviceSuffix: root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased(), fault: fault)
  }

  func testStrictJsonRejectsDuplicateKeysAndMalformedNumbers() {
    for text in ["{\"a\":1,\"a\":2}", #"{"a":1,"\u0061":2}"#, "{\"a\":01}", "{\"a\":1,}"] {
      XCTAssertThrowsError(try StrictStateJSON.check(text))
    }
    XCTAssertNoThrow(try StrictStateJSON.check("{\"a\":[true,null,3]}"))
  }

  func testPublishedStateSurvivesReopenAndIgnoresNextFile() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    let initial = try store.open()
    let images = root.appendingPathComponent("whatsapp/images")
    XCTAssertTrue((try images.resourceValues(forKeys: [.isExcludedFromBackupKey])).isExcludedFromBackup == true)
    XCTAssertEqual((initial["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 10 * 1024 * 1024)
    _ = try store.commit(expectedRevision: "0") { state in
      var next = state
      next["options"] = ["maxRecoveryBufferBytes": 20 * 1024 * 1024, "maxImageStorageBytes": 50 * 1024 * 1024]
      return next
    }
    let directory = root.appendingPathComponent("whatsapp")
    try Data("uncommitted".utf8).write(to: directory.appendingPathComponent("state.next"))
    let recovered = try makeStore(root).open()
    XCTAssertEqual((recovered["options"] as? [String: Int])?["maxRecoveryBufferBytes"], 20 * 1024 * 1024)
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("state.next").path))
  }

  func testRecoveryOnlyCommitPreservesSessionCiphertext() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try makeStore(root)
    _ = try store.open()
    try store.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let original = try XCTUnwrap((store.open()["session"] as? [String: Any])?["ciphertextBase64"] as? String)
    let next = try store.commit(expectedRevision: "1") { $0 }
    XCTAssertEqual((next["session"] as? [String: Any])?["ciphertextBase64"] as? String, original)
    XCTAssertTrue(try makeStore(root).canRestoreSession())
    let first = try XCTUnwrap(store.open()["session"] as? [String: Any])
    try store.endSession()
    XCTAssertTrue(try makeStore(root).open()["session"] is NSNull)
    try store.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    let second = try XCTUnwrap(store.open()["session"] as? [String: Any])
    XCTAssertNotEqual(first["sessionKeyId"] as? String, second["sessionKeyId"] as? String)
    XCTAssertNotEqual(first["nonceBase64"] as? String, second["nonceBase64"] as? String)
  }

  func testInterruptedCreationResumes() throws {
    for phase in ["creationRecord", "recoveryKey", "initialPublication"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      XCTAssertThrowsError(try makeStore(root) { if $0 == phase { throw StateStoreError.storage } }.open())
      let recovered = try makeStore(root).open()
      XCTAssertTrue(recovered["session"] is NSNull)
    }
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

  func testInjectedPublicationFailuresPreserveAReadableRevision() throws {
    for phase in ["cipher", "write", "sync", "close", "replace", "directorySync", "response"] {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var active = false
      let store = try makeStore(root) { reached in
        if active && reached == phase { throw StateStoreError.storage }
      }
      _ = try store.open()
      active = true
      XCTAssertThrowsError(try store.commit(expectedRevision: "0") { $0 })
      let expected = phase == "directorySync" || phase == "response" ? "1" : "0"
      let file = root.appendingPathComponent("whatsapp/state.bin")
      let bytes = try Data(contentsOf: file)
      let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
      let header = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes[12..<12+length]) as? [String: Any])
      XCTAssertEqual(header["revision"] as? String, expected)
      XCTAssertNoThrow(try makeStore(root).open())
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
      try recovered.beginSession(accountId: "123@lid", protocolBytes: Data("{\"protocolSchemaVersion\":1,\"records\":[]}".utf8))
    }
  }

  func testRealFilesystemFailureCannotReplacePublishedState() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let writer = try makeStore(root)
    _ = try writer.open()
    let next = root.appendingPathComponent("whatsapp/state.next")
    try FileManager.default.createDirectory(at: next, withIntermediateDirectories: false)
    XCTAssertThrowsError(try writer.commit(expectedRevision: "0") { $0 })
    try FileManager.default.removeItem(at: next)
    XCTAssertNoThrow(try makeStore(root).open())
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

  func testCorruptionNeverBecomesEmptyInstall() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    _ = try makeStore(root).open()
    let file = root.appendingPathComponent("whatsapp/state.bin")
    var data = try Data(contentsOf: file)
    data[data.count - 1] ^= 1
    try data.write(to: file)
    XCTAssertThrowsError(try makeStore(root).open())
  }

  func testMalformedEnvelopeDoesNotBecomeEmptyInstall() throws {
    let mutations: [(inout Data) -> Void] = [
      { $0[0] = 0 },
      { $0.replaceSubrange(8..<12, with: [0, 0, 16, 1]) },
      { $0.replaceSubrange(8..<12, with: [127, 255, 255, 255]) },
      { $0.removeLast() },
      { $0.append(0) },
      { $0[$0.count - 1] ^= 1 },
    ]
    for mutate in mutations {
      let root = try temporaryDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      _ = try makeStore(root).open()
      let file = root.appendingPathComponent("whatsapp/state.bin")
      var data = try Data(contentsOf: file)
      mutate(&data)
      try data.write(to: file)
      XCTAssertThrowsError(try makeStore(root).open())
      XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
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
      let file = root.appendingPathComponent("whatsapp/state.bin")
      let bytes = try Data(contentsOf: file)
      let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
      let header = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes[12..<12+length]) as? [String: Any])
      XCTAssertEqual(header["revision"] as? String, "0")
      XCTAssertNoThrow(try makeStore(root).open())
    }
  }
}
