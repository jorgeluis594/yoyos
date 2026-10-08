import Foundation
import CryptoKit
import Security
import CoreFoundation
import Darwin

public enum StateStoreError: Error {
  case invalid
  case storage
  case revision
  case sessionLimit
}

/** Native-only writer. Every mutation starts from the last authenticated published revision. */
public final class NativeStateStore {
  private static let writerLock = NSRecursiveLock()
  nonisolated(unsafe) private static var publication: UInt64 = 0
  private static let maxSession = 16 * 1024 * 1024
  private static let defaultBuffer = 10 * 1024 * 1024
  private static let maxRevision = UInt64.max
  private let directory: URL
  private let published: URL
  private let temporary: URL
  private let keychain: StateKeychain
  private let fault: ((String) throws -> Void)?
  private var storeId = ""
  private var recoveryId = ""
  private var revision: UInt64 = 0
  private var readBudget = defaultBuffer
  private var state: [String: Any]?
  private var uncertain = false
  private var sessionUsable = true
  private var observedPublication: UInt64?
  private let lock = NativeStateStore.writerLock

  public init(directory: URL? = nil, serviceSuffix: String = "", fault: ((String) throws -> Void)? = nil) throws {
    self.keychain = try StateKeychain(serviceSuffix: serviceSuffix)
    self.fault = fault
    let support = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let storageDirectory = support.appendingPathComponent("whatsapp", isDirectory: true)
    self.directory = storageDirectory
    self.published = storageDirectory.appendingPathComponent("state.bin")
    self.temporary = storageDirectory.appendingPathComponent("state.next")
  }

  public func open() throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    if uncertain { state = nil; uncertain = false }
    if observedPublication == Self.publication, let state { return state }
    state = nil
    let existed = try existsChecked(directory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try protect(directory)
    guard var record = try readRecord() else {
      let hasPublished = try existsChecked(published)
      let hasTemporary = try existsChecked(temporary)
      let hasKeyItems = try keychain.hasAnyItems()
      if hasPublished || hasTemporary || hasKeyItems { throw StateStoreError.invalid }
      if existed {
        let entries = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        if !entries.isEmpty { throw StateStoreError.invalid }
      }
      return try create()
    }
    guard let store = record["storeId"] as? String, Self.validId(store),
          let recovery = record["recoveryKeyId"] as? String, Self.validId(recovery),
          let bound = record["readBudget"] as? Int, bound > 0 else { throw StateStoreError.invalid }
    guard let preparedText = record["preparedRevision"] as? String, let preparedRevision = Self.parseRevision(preparedText) else { throw StateStoreError.invalid }
    storeId = store; recoveryId = recovery; readBudget = bound
    if try existsChecked(published) {
      let loaded = try readSnapshot()
      guard revision <= preparedRevision else { throw StateStoreError.invalid }
      if record["status"] as? String == "creating" {
        record["status"] = "ready"; try writeRecord(record)
      }
      try removeIfPresent(temporary)
      try ensureImagesDirectory()
      state = loaded
      observedPublication = Self.publication
      do {
        try cleanupProvisional(&record, publishedState: loaded)
        if let retired = loaded["sessionKeysToDelete"] as? [String], !retired.isEmpty {
          try endSession()
          return try open()
        }
      } catch {
        state = nil
        throw error
      }
      return state ?? loaded
    }
    guard record["status"] as? String == "creating" else { throw StateStoreError.invalid }
    try removeIfPresent(temporary)
    try keychain.ensureKey(recoveryId)
    let initial = Self.emptyState()
    try publish(initial, revision: 0)
    try fault?("initialPublication")
    record["status"] = "ready"; try writeRecord(record)
    try ensureImagesDirectory()
    state = initial
    observedPublication = Self.publication
    return initial
  }

  @discardableResult public func commit(expectedRevision: String, change: ([String: Any]) throws -> [String: Any]) throws -> [String: Any] {
    lock.lock(); var committed = false; defer { if !committed { state = nil }; lock.unlock() }
    let old = try open()
    let originalSession = try Self.json(old["session"] ?? NSNull())
    guard Self.parseRevision(expectedRevision) == revision else { throw StateStoreError.revision }
    guard revision < Self.maxRevision else { throw StateStoreError.invalid }
    let next = try change(old)
    guard let options = next["options"] as? [String: Any], let requested = Self.safeInt(options["maxRecoveryBufferBytes"]) else { throw StateStoreError.invalid }
    guard var record = try readRecord() else { throw StateStoreError.invalid }
    let nextBound = max(readBudget, requested)
    try validate(next, revision: revision + 1, bound: nextBound, allowSessionFailure: !sessionUsable && (try Self.json(next["session"] ?? NSNull())) == originalSession)
    record["readBudget"] = nextBound
    record["preparedRevision"] = String(revision + 1)
    try writeRecord(record)
    readBudget = nextBound
    try publish(next, revision: revision + 1)
    state = next
    observedPublication = Self.publication
    committed = true
    return next
  }

  public func beginSession(accountId: String, protocolBytes: Data) throws {
    lock.lock(); defer { state = nil; lock.unlock() }
    state = nil
    let existing = try open()
    guard Self.validAccount(accountId), existing["session"] is NSNull,
          let retired = existing["sessionKeysToDelete"] as? [String], retired.isEmpty else { throw StateStoreError.invalid }
    guard protocolBytes.count <= Self.maxSession else { throw StateStoreError.sessionLimit }
    guard revision < UInt64.max else { throw StateStoreError.invalid }
    let protocolState = try Self.parseObject(protocolBytes)
    try Self.exact(protocolState, ["protocolSchemaVersion", "records"])
    guard Self.safeInt(protocolState["protocolSchemaVersion"]) == 1,
          protocolState["records"] is [Any] else { throw StateStoreError.invalid }
    guard var record = try readRecord() else { throw StateStoreError.invalid }
    let id = try Self.randomId()
    record["provisionalSessionKeyId"] = id; try writeRecord(record)
    try fault?("provisionalRecord")
    try keychain.ensureKey(id)
    try fault?("sessionKey")
    let nextRevision = revision + 1
    let nonce = AES.GCM.Nonce()
    let sealed = try AES.GCM.seal(protocolBytes, using: try keychain.key(id), nonce: nonce,
                                  authenticating: Self.sessionAAD(storeId, accountId, id, String(nextRevision)))
    let session: [String: Any] = ["accountId": accountId, "sessionKeyId": id, "sessionRevision": String(nextRevision),
                                  "nonceBase64": Data(nonce).base64EncodedString(),
                                  "ciphertextBase64": sealed.ciphertext.appended(sealed.tag).base64EncodedString()]
    _ = try commit(expectedRevision: String(revision)) { old in
      var next = old; next["session"] = session; return next
    }
    try fault?("sessionPublished")
    guard var committedRecord = try readRecord() else { throw StateStoreError.invalid }
    committedRecord["provisionalSessionKeyId"] = NSNull(); try writeRecord(committedRecord)
  }

  public func canRestoreSession() throws -> Bool {
    lock.lock(); defer { lock.unlock() }
    _ = try open()
    return sessionUsable
  }

  public func endSession() throws {
    lock.lock(); defer { state = nil; lock.unlock() }
    var old = try open()
    if let session = old["session"] as? [String: Any], let id = session["sessionKeyId"] as? String {
      old = try commit(expectedRevision: String(revision)) { current in
        var next = current; next["session"] = NSNull(); next["sessionKeysToDelete"] = [id]; return next
      }
      try fault?("retiredPublished")
    }
    guard let retired = old["sessionKeysToDelete"] as? [String] else { throw StateStoreError.invalid }
    if let id = retired.first {
      guard Self.validId(id), id != recoveryId else { throw StateStoreError.invalid }
      try fault?("deleteSessionKey")
      try keychain.delete(id)
      try fault?("keyDeleted")
      _ = try commit(expectedRevision: String(revision)) { current in
        var next = current; next["sessionKeysToDelete"] = [String](); return next
      }
    }
  }

  private func create() throws -> [String: Any] {
    storeId = try Self.randomId(); recoveryId = try Self.randomId(); readBudget = Self.defaultBuffer
    var record: [String: Any] = ["status": "creating", "storeId": storeId, "recoveryKeyId": recoveryId,
                                 "readBudget": readBudget, "preparedRevision": "0", "provisionalSessionKeyId": NSNull()]
    try writeRecord(record)
    try fault?("creationRecord")
    try keychain.ensureKey(recoveryId)
    try fault?("recoveryKey")
    let initial = Self.emptyState()
    try publish(initial, revision: 0)
    try fault?("initialPublication")
    record["status"] = "ready"; try writeRecord(record)
    try ensureImagesDirectory()
    state = initial
    observedPublication = Self.publication
    return initial
  }

  private func cleanupProvisional(_ record: inout [String: Any], publishedState: [String: Any]) throws {
    guard let id = record["provisionalSessionKeyId"] as? String else { return }
    guard Self.validId(id), id != recoveryId else { throw StateStoreError.invalid }
    let session = publishedState["session"] as? [String: Any]
    if session?["sessionKeyId"] as? String != id {
      try fault?("cleanupProvisional")
      try keychain.delete(id)
    }
    record["provisionalSessionKeyId"] = NSNull(); try writeRecord(record)
  }

  private func publish(_ next: [String: Any], revision newRevision: UInt64) throws {
    let plaintext = try Self.json(next)
    let header = try Self.json(["formatVersion": 1, "storeId": storeId, "revision": String(newRevision), "recoveryKeyId": recoveryId])
    guard header.count <= 4096, plaintext.count <= Self.maxSession + readBudget + 4096 else { throw StateStoreError.invalid }
    let nonce = AES.GCM.Nonce()
    var prefix = Data("YOYOWA01".utf8)
    prefix.append(Self.be32(UInt32(header.count))); prefix.append(header); prefix.append(contentsOf: nonce)
    prefix.append(Self.be64(UInt64(plaintext.count + 16)))
    try fault?("cipher")
    let sealed = try AES.GCM.seal(plaintext, using: try keychain.key(recoveryId), nonce: nonce, authenticating: prefix)
    let bytes = prefix + sealed.ciphertext + sealed.tag
    uncertain = true
    try durableWrite(bytes, to: temporary, replacing: published)
    Self.publication &+= 1
    try fault?("directorySync")
    try syncDirectory()
    revision = newRevision
    try fault?("response")
    uncertain = false
  }

  private func readSnapshot() throws -> [String: Any] {
    let attributes = try FileManager.default.attributesOfItem(atPath: published.path)
    guard let size = attributes[.size] as? NSNumber,
          size.int64Value >= 48, size.int64Value <= Int64(Self.maxSession + readBudget + 8244) else { throw StateStoreError.invalid }
    let handle = try FileHandle(forReadingFrom: published)
    defer { try? handle.close() }
    var bytes = Data()
    while bytes.count <= size.intValue {
      let chunk = try handle.read(upToCount: min(64 * 1024, size.intValue + 1 - bytes.count)) ?? Data()
      if chunk.isEmpty { break }
      bytes.append(chunk)
    }
    guard bytes.count == size.intValue, bytes.prefix(8) == Data("YOYOWA01".utf8) else { throw StateStoreError.invalid }
    var offset = 8
    let headerLength = Int(Self.uint32(bytes, at: offset)); offset += 4
    guard headerLength > 0, headerLength <= 4096, headerLength <= bytes.count - offset - 36 else { throw StateStoreError.invalid }
    let header = try Self.parseObject(bytes.subdata(in: offset..<offset+headerLength)); offset += headerLength
    try Self.exact(header, ["formatVersion", "storeId", "revision", "recoveryKeyId"])
    guard Self.safeInt(header["formatVersion"]) == 1,
          header["storeId"] as? String == storeId, header["recoveryKeyId"] as? String == recoveryId,
          let number = header["revision"] as? String, let loadedRevision = Self.parseRevision(number) else { throw StateStoreError.invalid }
    let nonce = try AES.GCM.Nonce(data: bytes.subdata(in: offset..<offset+12)); offset += 12
    let length = Self.uint64(bytes, at: offset); offset += 8
    guard length >= 16, length <= UInt64(Self.maxSession + readBudget + 4096 + 16), length == UInt64(bytes.count - offset) else { throw StateStoreError.invalid }
    let body = bytes.subdata(in: offset..<bytes.count)
    let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: body.dropLast(16), tag: body.suffix(16))
    let plaintext = try AES.GCM.open(box, using: try keychain.key(recoveryId), authenticating: bytes.prefix(offset))
    let loaded = try Self.parseObject(plaintext)
    try validate(loaded, revision: loadedRevision, bound: readBudget, allowSessionFailure: true)
    revision = loadedRevision
    return loaded
  }

  private func validate(_ snapshot: [String: Any], revision: UInt64, bound: Int, allowSessionFailure: Bool = false) throws {
    try Self.exact(snapshot, ["session", "pending", "sessionKeysToDelete", "options", "androidService"])
    guard let options = snapshot["options"] as? [String: Any] else { throw StateStoreError.invalid }
    try Self.exact(options, ["maxRecoveryBufferBytes", "maxImageStorageBytes"])
    for key in ["maxRecoveryBufferBytes", "maxImageStorageBytes"] {
      guard let value = Self.safeInt(options[key]), value > 0, value <= 9_007_199_254_740_991 else { throw StateStoreError.invalid }
    }
    if let service = snapshot["androidService"] as? [String: Any] {
      // iOS never persists an Android service intent.
      _ = service; throw StateStoreError.invalid
    }
    guard snapshot["androidService"] is NSNull else { throw StateStoreError.invalid }
    let sessionData = try Self.json(snapshot["session"] ?? NSNull())
    let oversizedSession = sessionData.count > Self.maxSession
    if oversizedSession && !allowSessionFailure { throw StateStoreError.sessionLimit }
    if let session = snapshot["session"] as? [String: Any] {
      try Self.exact(session, ["accountId", "sessionKeyId", "sessionRevision", "nonceBase64", "ciphertextBase64"])
      guard let account = session["accountId"] as? String, Self.validAccount(account),
            let id = session["sessionKeyId"] as? String, Self.validId(id), id != recoveryId,
            let number = session["sessionRevision"] as? String, let sessionRevision = Self.parseRevision(number), sessionRevision <= revision,
            session["nonceBase64"] is String, session["ciphertextBase64"] is String else { throw StateStoreError.invalid }
      guard let nonceText = session["nonceBase64"] as? String, let nonceData = Self.decode(nonceText, max: 12), nonceData.count == 12 else { throw StateStoreError.invalid }
      if oversizedSession {
        guard let ciphertext = session["ciphertextBase64"] as? String, ciphertext.count >= 24,
              Self.canonicalBase64(ciphertext) else { throw StateStoreError.invalid }
        sessionUsable = false
      } else {
        guard let ciphertextText = session["ciphertextBase64"] as? String,
              let ciphertext = Self.decode(ciphertextText, max: Self.maxSession), ciphertext.count >= 16 else { throw StateStoreError.invalid }
        do {
          let nonce = try AES.GCM.Nonce(data: nonceData)
          let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
          let plain = try AES.GCM.open(box, using: try keychain.key(id), authenticating: Self.sessionAAD(storeId, account, id, number))
          let protocolState = try Self.parseObject(plain)
          try Self.exact(protocolState, ["protocolSchemaVersion", "records"])
          guard Self.safeInt(protocolState["protocolSchemaVersion"]) == 1, protocolState["records"] is [Any] else { throw StateStoreError.invalid }
          sessionUsable = true
        } catch {
          sessionUsable = false
          if !allowSessionFailure { throw StateStoreError.invalid }
        }
      }
    } else if !(snapshot["session"] is NSNull) { throw StateStoreError.invalid }
    else { sessionUsable = true }
    guard let retired = snapshot["sessionKeysToDelete"] as? [String], retired.count <= 1,
          retired.allSatisfy({ Self.validId($0) && $0 != recoveryId && $0 != ((snapshot["session"] as? [String: Any])?["sessionKeyId"] as? String) }) else { throw StateStoreError.invalid }
    guard let pending = snapshot["pending"] as? [[String: Any]], try Self.json(pending).count <= bound else { throw StateStoreError.invalid }
    var ordinals = Set<String>()
    var deliveryIds = Set<String>()
    for item in pending {
      var fields: Set<String> = ["deliveryId", "accountId", "createdRevision", "createdOrdinal", "source", "identityState", "recovery"]
      if item["message"] != nil { fields.insert("message") }
      try Self.exact(item, fields)
      guard let delivery = item["deliveryId"] as? String, delivery.range(of: "^wa-delivery:v1:[0-9a-f]{32}\\z", options: .regularExpression) != nil,
            let account = item["accountId"] as? String, Self.validAccount(account),
            let createdText = item["createdRevision"] as? String, let created = Self.parseRevision(createdText), created <= revision,
            let ordinal = Self.safeInt(item["createdOrdinal"]), ordinal >= 0, ordinal <= Int(UInt32.max),
            ordinals.insert("\(created):\(ordinal)").inserted,
            deliveryIds.insert(delivery).inserted,
            let source = item["source"] as? String, ["live", "history"].contains(source),
            let identity = item["identityState"] as? String, ["pendingLid", "resolved"].contains(identity),
            (identity == "resolved") == (item["message"] != nil),
            let recovery = item["recovery"] as? [String: Any] else { throw StateStoreError.invalid }
      if let message = item["message"] {
        guard let object = message as? [String: Any] else { throw StateStoreError.invalid }
        try Self.validateMessage(object, account: account)
      }
      try Self.exact(recovery, ["messageInfoJson", "items"])
      guard let info = recovery["messageInfoJson"] as? String, let infoData = info.data(using: .utf8),
            (try? Self.parseObject(infoData)) != nil, let children = recovery["items"] as? [[String: Any]] else { throw StateStoreError.invalid }
      for child in children {
        var expected: Set<String> = ["format", "plaintextBase64"]
        if child["ciphertextHashBase64"] != nil { expected.insert("ciphertextHashBase64") }
        try Self.exact(child, expected)
        guard let format = child["format"] as? String, ["v2", "v3", "history"].contains(format),
              let body = child["plaintextBase64"] as? String, Self.decode(body, max: bound) != nil else { throw StateStoreError.invalid }
        guard (source == "history") == (format == "history") else { throw StateStoreError.invalid }
        if format == "history" && child["ciphertextHashBase64"] != nil { throw StateStoreError.invalid }
        if format != "history" {
          guard let hash = child["ciphertextHashBase64"] as? String, Self.decode(hash, max: 32)?.count == 32 else { throw StateStoreError.invalid }
        }
      }
    }
    let total = try Self.json(snapshot).count
    guard total - sessionData.count - (try Self.json(pending)).count <= 4096 else { throw StateStoreError.invalid }
  }

  private static func validateMessage(_ message: [String: Any], account: String) throws {
    var fields: Set<String> = ["id", "accountId", "whatsappMessageId", "chatId", "direction", "timestamp"]
    if message["text"] != nil { fields.insert("text") }
    if message["image"] != nil { fields.insert("image") }
    try exact(message, fields)
    guard let chat = message["chatId"] as? String, validAccount(chat),
          message["accountId"] as? String == account,
          let whatsappId = message["whatsappMessageId"] as? String, !whatsappId.isEmpty,
          let direction = message["direction"] as? String, ["incoming", "outgoing"].contains(direction),
          let timestamp = safeInt(message["timestamp"]), timestamp >= 0, timestamp <= 9_007_199_254_740_991 else { throw StateStoreError.invalid }
    if message["text"] != nil && !(message["text"] is String) { throw StateStoreError.invalid }
    guard let id = message["id"] as? String, id.hasPrefix("wa-message:v1:") else { throw StateStoreError.invalid }
    let encoded = String(id.dropFirst("wa-message:v1:".count))
    guard encoded.count <= 8192, encoded.range(of: "^[A-Za-z0-9_-]+\\z", options: .regularExpression) != nil else { throw StateStoreError.invalid }
    let standard = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let padded = standard + String(repeating: "=", count: (4 - standard.count % 4) % 4)
    guard let decoded = Data(base64Encoded: padded),
          decoded.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == encoded,
          let text = String(data: decoded, encoding: .utf8) else { throw StateStoreError.invalid }
    try StrictStateJSON.check(text)
    guard let tuple = try JSONSerialization.jsonObject(with: decoded) as? [String], tuple.count == 3,
          tuple[0] == account, tuple[1] == chat, tuple[2] == whatsappId else { throw StateStoreError.invalid }
    if let image = message["image"] {
      guard let image = image as? [String: Any] else { throw StateStoreError.invalid }
      var imageFields: Set<String> = ["reference"]
      if image["mimeType"] != nil { imageFields.insert("mimeType") }
      if image["size"] != nil { imageFields.insert("size") }
      try exact(image, imageFields)
      guard let reference = image["reference"] as? [String: Any] else { throw StateStoreError.invalid }
      try exact(reference, ["messageId", "downloadReference"])
      guard reference["messageId"] as? String == id,
            let opaque = reference["downloadReference"] as? String, !opaque.isEmpty else { throw StateStoreError.invalid }
      if image["mimeType"] != nil && !(image["mimeType"] is String) { throw StateStoreError.invalid }
      if image["size"] != nil {
        guard let size = safeInt(image["size"]), size >= 0, size <= 9_007_199_254_740_991 else { throw StateStoreError.invalid }
      }
    }
  }

  private func readRecord() throws -> [String: Any]? {
    guard let data = try keychain.data("record") else { return nil }
    guard data.count <= 4096 else { throw StateStoreError.invalid }
    let record = try Self.parseObject(data)
    try Self.exact(record, ["status", "storeId", "recoveryKeyId", "readBudget", "preparedRevision", "provisionalSessionKeyId"])
    guard let status = record["status"] as? String, ["creating", "ready"].contains(status) else { throw StateStoreError.invalid }
    return record
  }

  private func writeRecord(_ record: [String: Any]) throws {
    let data = try Self.json(record)
    guard data.count <= 4096 else { throw StateStoreError.invalid }
    do {
      try keychain.put("record", data: data)
      try fault?("recordResponse")
    } catch {
      state = nil
      throw error
    }
  }

  private func durableWrite(_ bytes: Data, to next: URL, replacing target: URL) throws {
    try removeIfPresent(next)
    let fd = Darwin.open(next.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(S_IRUSR | S_IWUSR))
    guard fd >= 0 else { throw StateStoreError.storage }
    var closed = false
    defer { if !closed { _ = Darwin.close(fd) } }
    try protect(next)
    if target == published { try fault?("write") }
    try bytes.withUnsafeBytes { buffer in
      guard let base = buffer.baseAddress else { throw StateStoreError.storage }
      var offset = 0
      while offset < bytes.count {
        let count = Darwin.write(fd, base.advanced(by: offset), bytes.count - offset)
        if count <= 0 { throw StateStoreError.storage }
        offset += count
      }
    }
    if target == published { try fault?("sync") }
    guard fsync(fd) == 0 else { throw StateStoreError.storage }
    if target == published { try fault?("close") }
    let closeStatus = Darwin.close(fd)
    closed = true
    guard closeStatus == 0 else { throw StateStoreError.storage }
    if target == published { try fault?("replace") }
    guard rename(next.path, target.path) == 0 else { throw StateStoreError.storage }
  }

  private func syncDirectory() throws {
    let fd = Darwin.open(directory.path, O_RDONLY)
    guard fd >= 0 else { throw StateStoreError.storage }
    if fsync(fd) != 0 {
      NSLog("WhatsApp state directory sync failed: %d", errno)
      _ = Darwin.close(fd)
      throw StateStoreError.storage
    }
    guard Darwin.close(fd) == 0 else { throw StateStoreError.storage }
  }
  private func protect(_ url: URL) throws {
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var mutableURL = url
    try mutableURL.setResourceValues(values)
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    #endif
  }
  private func ensureImagesDirectory() throws {
    let images = directory.appendingPathComponent("images", isDirectory: true)
    try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
    try protect(images)
  }
  private func existsChecked(_ url: URL) throws -> Bool {
    var info = stat()
    if lstat(url.path, &info) == 0 { return true }
    if errno == ENOENT { return false }
    throw StateStoreError.storage
  }
  private func removeIfPresent(_ url: URL) throws {
    var info = stat()
    if lstat(url.path, &info) == 0 {
      guard (info.st_mode & mode_t(S_IFMT)) != mode_t(S_IFDIR) else { throw StateStoreError.storage }
      try FileManager.default.removeItem(at: url)
    } else if errno != ENOENT { throw StateStoreError.storage }
  }

  private static func emptyState() -> [String: Any] {
    ["session": NSNull(), "pending": [[String: Any]](), "sessionKeysToDelete": [String](),
     "options": ["maxRecoveryBufferBytes": defaultBuffer, "maxImageStorageBytes": 50 * 1024 * 1024], "androidService": NSNull()]
  }
  private static func randomId() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
    guard status == errSecSuccess else { throw StateStoreError.storage }
    return bytes.map { String(format: "%02x", $0) }.joined()
  }
  private static func validId(_ value: String) -> Bool { value.range(of: "^[0-9a-f]{32}\\z", options: .regularExpression) != nil }
  private static func validAccount(_ value: String) -> Bool { value.range(of: "^[0-9]+@lid\\z", options: .regularExpression) != nil }
  private static func parseRevision(_ value: String) -> UInt64? {
    guard value.range(of: "^(0|[1-9][0-9]*)\\z", options: .regularExpression) != nil else { return nil }
    return UInt64(value)
  }
  private static func safeInt(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          let integer = Int(number.stringValue), String(integer) == number.stringValue else { return nil }
    return integer
  }
  private static func decode(_ text: String, max: Int) -> Data? {
    guard text.count <= ((max + 2) / 3) * 4, canonicalBase64(text),
          let decoded = Data(base64Encoded: text), decoded.count <= max, decoded.base64EncodedString() == text else { return nil }
    return decoded
  }
  private static func canonicalBase64(_ text: String) -> Bool {
    guard text.utf8.count % 4 == 0 else { return false }
    var padding = 0
    var last = 0
    for byte in text.utf8 {
      if byte == 61 { padding += 1; continue }
      guard padding == 0 else { return false }
      switch byte {
      case 65...90: last = Int(byte - 65)
      case 97...122: last = Int(byte - 97) + 26
      case 48...57: last = Int(byte - 48) + 52
      case 43: last = 62
      case 47: last = 63
      default: return false
      }
    }
    return padding <= 2 && (padding == 0 || text.utf8.count >= 4) &&
      (padding == 0 || (last & ((1 << (2 * padding)) - 1)) == 0)
  }
  private static func exact(_ object: [String: Any], _ fields: Set<String>) throws {
    guard Set(object.keys) == fields else { throw StateStoreError.invalid }
  }
  private static func json(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed, .sortedKeys, .withoutEscapingSlashes])
  }
  static func parseObject(_ bytes: Data) throws -> [String: Any] {
    guard let string = String(data: bytes, encoding: .utf8), Data(string.utf8) == bytes else { throw StateStoreError.invalid }
    try StrictStateJSON.check(string)
    guard let result = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw StateStoreError.invalid }
    return result
  }
  private static func sessionAAD(_ store: String, _ account: String, _ key: String, _ revision: String) -> Data {
    Data("[\"yoyos-whatsapp-session\",1,\"\(store)\",\"\(account)\",\"\(key)\",\"\(revision)\"]".utf8)
  }
  private static func be32(_ value: UInt32) -> Data { withUnsafeBytes(of: value.bigEndian) { Data($0) } }
  private static func be64(_ value: UInt64) -> Data { withUnsafeBytes(of: value.bigEndian) { Data($0) } }
  private static func uint32(_ data: Data, at offset: Int) -> UInt32 { data[offset..<offset+4].reduce(0) { ($0 << 8) | UInt32($1) } }
  private static func uint64(_ data: Data, at offset: Int) -> UInt64 { data[offset..<offset+8].reduce(0) { ($0 << 8) | UInt64($1) } }
}

private final class StateKeychain {
  private let service: String
  init(serviceSuffix: String) throws {
    guard serviceSuffix.isEmpty || serviceSuffix.range(of: "^[0-9a-f]{32}\\z", options: .regularExpression) != nil else { throw StateStoreError.invalid }
    service = "com.yoyos.whatsapp.state" + (serviceSuffix.isEmpty ? "" : ".test." + serviceSuffix)
  }
  private func query(_ id: String) throws -> [String: Any] {
    guard id == "record" || id.range(of: "^[0-9a-f]{32}\\z", options: .regularExpression) != nil else { throw StateStoreError.invalid }
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: id,
            kSecUseDataProtectionKeychain as String: true]
  }
  func data(_ id: String) throws -> Data? {
    var request = try query(id)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { NSLog("WhatsApp state keychain read failed: %d", status); throw StateStoreError.storage }
    guard let data = result as? Data else { throw StateStoreError.invalid }
    return data
  }
  func hasAnyItems() throws -> Bool {
    let request: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrService as String: service,
                                  kSecMatchLimit as String: kSecMatchLimitOne,
                                  kSecReturnAttributes as String: true,
                                  kSecUseDataProtectionKeychain as String: true]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return false }
    guard status == errSecSuccess else { NSLog("WhatsApp state keychain enumeration failed: %d", status); throw StateStoreError.storage }
    return true
  }
  func put(_ id: String, data: Data) throws {
    let existing = try self.data(id)
    let status: OSStatus
    if existing == nil {
      var request = try query(id)
      request[kSecValueData as String] = data
      request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      request[kSecAttrSynchronizable as String] = false
      status = SecItemAdd(request as CFDictionary, nil)
    } else {
      status = SecItemUpdate(try query(id) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    }
    if status == errSecSuccess { return }
    NSLog("WhatsApp state keychain write failed: %d", status)
    // The Keychain operation may have completed despite a lost response; inspect its durable value.
    guard try self.data(id) == data else { throw StateStoreError.storage }
  }
  func key(_ id: String) throws -> SymmetricKey {
    guard id != "record", let bytes = try data(id), bytes.count == 32 else { throw StateStoreError.invalid }
    return SymmetricKey(data: bytes)
  }
  func ensureKey(_ id: String) throws {
    if let bytes = try data(id) {
      guard bytes.count == 32 else { throw StateStoreError.invalid }
      return
    }
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
    guard status == errSecSuccess else { throw StateStoreError.storage }
    try put(id, data: Data(bytes))
  }
  func delete(_ id: String) throws {
    let status = SecItemDelete(try query(id) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw StateStoreError.storage }
  }
}

private extension Data {
  func appended(_ other: Data) -> Data { self + other }
}
