import XCTest
import Foundation
import Security
import CryptoKit
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
    let stateFile = root.appendingPathComponent("whatsapp/state.bin")
    let protected = try stateFile.resourceValues(forKeys: [.isExcludedFromBackupKey, .fileProtectionKey])
    XCTAssertTrue(protected.isExcludedFromBackup == true)
    XCTAssertEqual(protected.fileProtection, .completeUntilFirstUserAuthentication)
    let stateBytes = try Data(contentsOf: stateFile)
    let headerLength = stateBytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
    let header = try XCTUnwrap(JSONSerialization.jsonObject(with: stateBytes[12..<12+headerLength]) as? [String: Any])
    let keyId = try XCTUnwrap(header["recoveryKeyId"] as? String)
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
    func containerNonce() throws -> Data {
      let bytes = try Data(contentsOf: root.appendingPathComponent("whatsapp/state.bin"))
      let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
      return bytes[12+length..<24+length]
    }
    let outerNonce = try containerNonce()
    let next = try store.commit(expectedRevision: "1") { $0 }
    XCTAssertEqual((next["session"] as? [String: Any])?["ciphertextBase64"] as? String, original)
    XCTAssertNotEqual(outerNonce, try containerNonce())
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
    for phase in ["recordResponse", "cipher", "write", "sync", "close", "replace", "directorySync", "response"] {
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

  func testUncertainPublicationIsRereadBeforeNextMutation() throws {
    for phase in ["directorySync", "response"] {
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
    XCTAssertThrowsError(try makeStore(root).open())
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
    let initial = try makeStore(root).open()
    let file = root.appendingPathComponent("whatsapp/state.bin")
    let original = try Data(contentsOf: file)
    let oldHeaderLength = original[8..<12].reduce(0) { ($0 << 8) | Int($1) }
    var header = try XCTUnwrap(JSONSerialization.jsonObject(with: original[12..<12+oldHeaderLength]) as? [String: Any])
    let maximum = "18446744073709551615"
    header["revision"] = maximum
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    func data(_ id: String) throws -> Data {
      let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                  kSecAttrAccount as String: id, kSecReturnData as String: true,
                                  kSecUseDataProtectionKeychain as String: true]
      var result: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let bytes = result as? Data else { throw StateStoreError.storage }
      return bytes
    }
    var record = try XCTUnwrap(JSONSerialization.jsonObject(with: data("record")) as? [String: Any])
    record["preparedRevision"] = maximum
    let recordQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                     kSecAttrAccount as String: "record", kSecUseDataProtectionKeychain as String: true]
    let recordBytes = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    XCTAssertEqual(SecItemUpdate(recordQuery as CFDictionary, [kSecValueData as String: recordBytes] as CFDictionary), errSecSuccess)
    let keyId = try XCTUnwrap(header["recoveryKeyId"] as? String)
    let key = SymmetricKey(data: try data(keyId))
    let headerBytes = try JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
    let plaintext = try JSONSerialization.data(withJSONObject: initial, options: [.sortedKeys])
    let nonce = AES.GCM.Nonce()
    var prefix = Data("YOYOWA01".utf8)
    prefix.append(contentsOf: withUnsafeBytes(of: UInt32(headerBytes.count).bigEndian) { Data($0) })
    prefix.append(headerBytes)
    prefix.append(contentsOf: nonce)
    prefix.append(contentsOf: withUnsafeBytes(of: UInt64(plaintext.count + 16).bigEndian) { Data($0) })
    let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: prefix)
    try (prefix + sealed.ciphertext + sealed.tag).write(to: file)
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
    XCTAssertTrue(try makeStore(root).canRestoreSession())
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
    let file = root.appendingPathComponent("whatsapp/state.bin")
    let original = try Data(contentsOf: file)
    let headerLength = original[8..<12].reduce(0) { ($0 << 8) | Int($1) }
    let header = original[12..<12+headerLength]
    let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: header) as? [String: Any])
    let recoveryId = try XCTUnwrap(fields["recoveryKeyId"] as? String)
    let service = "com.yoyos.whatsapp.state.test." + root.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: recoveryId, kSecReturnData as String: true,
                                kSecUseDataProtectionKeychain as String: true]
    var result: CFTypeRef?
    XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
    let key = SymmetricKey(data: try XCTUnwrap(result as? Data))
    let session: [String: Any] = ["accountId": "123@lid", "sessionKeyId": String(repeating: "a", count: 32),
                                  "sessionRevision": "0", "nonceBase64": "AAAAAAAAAAAAAAAA",
                                  "ciphertextBase64": String(repeating: "A", count: 16 * 1024 * 1024)]
    let pending: [String: Any] = ["deliveryId": "wa-delivery:v1:" + String(repeating: "c", count: 32),
                                  "accountId": "123@lid", "createdRevision": "0", "createdOrdinal": 0,
                                  "source": "live", "identityState": "pendingLid",
                                  "recovery": ["messageInfoJson": "{}", "items": [[String: Any]]()]]
    let state: [String: Any] = ["session": session, "pending": [pending], "sessionKeysToDelete": [String](),
                                 "options": ["maxRecoveryBufferBytes": 10 * 1024 * 1024, "maxImageStorageBytes": 50 * 1024 * 1024],
                                 "androidService": NSNull()]
    let plaintext = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
    let nonce = AES.GCM.Nonce()
    var prefix = Data("YOYOWA01".utf8)
    prefix.append(contentsOf: withUnsafeBytes(of: UInt32(headerLength).bigEndian) { Data($0) })
    prefix.append(contentsOf: header)
    prefix.append(contentsOf: nonce)
    prefix.append(contentsOf: withUnsafeBytes(of: UInt64(plaintext.count + 16).bigEndian) { Data($0) })
    let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: prefix)
    try (prefix + sealed.ciphertext + sealed.tag).write(to: file)
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
    let file = root.appendingPathComponent("whatsapp/state.bin")
    var data = try Data(contentsOf: file)
    data[data.count - 1] ^= 1
    try data.write(to: file)
    XCTAssertThrowsError(try makeStore(root).open())
  }

  func testEstablishedStateNeverRegeneratesMissingFileOrKeychainRecord() throws {
    let missingFile = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingFile) }
    _ = try makeStore(missingFile).open()
    try FileManager.default.removeItem(at: missingFile.appendingPathComponent("whatsapp/state.bin"))
    XCTAssertThrowsError(try makeStore(missingFile).open())

    let missingRecord = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingRecord) }
    _ = try makeStore(missingRecord).open()
    let service = "com.yoyos.whatsapp.state.test." + missingRecord.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "record", kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(query as CFDictionary), errSecSuccess)
    try FileManager.default.removeItem(at: missingRecord.appendingPathComponent("whatsapp/state.bin"))
    XCTAssertThrowsError(try makeStore(missingRecord).open())

    let missingKey = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: missingKey) }
    _ = try makeStore(missingKey).open()
    let bytes = try Data(contentsOf: missingKey.appendingPathComponent("whatsapp/state.bin"))
    let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
    let header = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes[12..<12+length]) as? [String: Any])
    let recoveryId = try XCTUnwrap(header["recoveryKeyId"] as? String)
    let keyService = "com.yoyos.whatsapp.state.test." + missingKey.lastPathComponent.replacingOccurrences(of: "-", with: "").lowercased()
    let keyQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keyService,
                                   kSecAttrAccount as String: recoveryId, kSecUseDataProtectionKeychain as String: true]
    XCTAssertEqual(SecItemDelete(keyQuery as CFDictionary), errSecSuccess)
    XCTAssertThrowsError(try makeStore(missingKey).open())
  }

  func testMalformedEnvelopeDoesNotBecomeEmptyInstall() throws {
    let mutations: [(inout Data) -> Void] = [
      { $0[0] = 0 },
      { $0.replaceSubrange(8..<12, with: [0, 0, 16, 1]) },
      { $0.replaceSubrange(8..<12, with: [127, 255, 255, 255]) },
      { bytes in
        let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        let header = String(decoding: bytes[12..<12+length], as: UTF8.self)
        let marker = "\"revision\":\"0\""
        let index = header.range(of: marker)!.lowerBound.utf16Offset(in: header) + "\"revision\":\"".count
        bytes[12 + index] = 0x31
      },
      { bytes in
        let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        bytes[12 + length] ^= 1
      },
      { bytes in
        let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        bytes.replaceSubrange(12+length+12..<12+length+20, with: [0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
      },
      { bytes in
        let length = bytes[8..<12].reduce(0) { ($0 << 8) | Int($1) }
        bytes.replaceSubrange(12+length+12..<12+length+20, with: [0, 0, 0, 0, 0, 0, 0, 15])
      },
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
    let oversized = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: oversized) }
    _ = try makeStore(oversized).open()
    let file = oversized.appendingPathComponent("whatsapp/state.bin")
    let handle = try FileHandle(forWritingTo: file)
    try handle.truncate(atOffset: UInt64(16 * 1024 * 1024 + 10 * 1024 * 1024 + 8245))
    try handle.close()
    XCTAssertThrowsError(try makeStore(oversized).open())
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
