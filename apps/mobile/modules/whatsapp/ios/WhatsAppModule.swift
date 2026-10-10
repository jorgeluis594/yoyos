import ExpoModulesCore
import WhatsAppGo
import Foundation
import CoreFoundation

private final class ProbeStorage: NSObject, YYWhatsAppGoBridgeStorageProtocol {
  let fail: Bool

  init(fail: Bool) { self.fail = fail }

  func commit(_ value: String?, error: NSErrorPointer) -> String {
    if fail {
      error?.pointee = NSError(domain: "WhatsAppProbe", code: 1)
      return ""
    }
    return value ?? ""
  }
}

private final class NativeProtocolStorage: NSObject, YYWhatsAppGoBridgeProtocolStorageProtocol {
  let writer: NativeStateStore
  init(writer: NativeStateStore) { self.writer = writer }
  func readState(_ request: String?, error: NSErrorPointer) -> String {
    writer.readProtocolState(request ?? "")
  }
  func applyChanges(_ request: String?, error: NSErrorPointer) -> String {
    writer.applyProtocolChanges(request ?? "")
  }
  func beginFreshSession(_ request: String?, error: NSErrorPointer) -> String {
    writer.beginFreshProtocolSession(request ?? "")
  }
}

func openProtocolSession(writer: NativeStateStore, generationId: String, accountId: String,
                         readRecoveryBytes: Int64, newRecoveryBytes: Int64) throws -> YYWhatsAppGoBridgeProtocolSession {
  try writer.registerGeneration(generationId, accountId: accountId)
  guard let result = YYWhatsAppGoBridgeOpenProtocolStore(NativeProtocolStorage(writer: writer), generationId,
                                                          accountId, readRecoveryBytes, newRecoveryBytes),
        result.code.isEmpty, let session = result.session else {
    writer.retireGeneration()
    throw StateStoreError.storage
  }
  return session
}

private final class NativeDeliveryStorage: NSObject, YYWhatsAppGoBridgeDeliveryStorageProtocol {
  let writer: NativeStateStore
  init(writer: NativeStateStore) { self.writer = writer }
  func readPending(_ request: String?, error: NSErrorPointer) -> String { writer.readPending(request ?? "") }
  func retirePending(_ request: String?, error: NSErrorPointer) -> String { writer.retirePending(request ?? "") }
}

private func jsonValue(_ value: Any) -> Any? {
  if value is NSNull { return nil }
  if let object = value as? [String: Any] { return object.compactMapValues(jsonValue) }
  if let list = value as? [Any] { return list.compactMap(jsonValue) }
  return value
}

/// Receives Go deliveries on the coordinator's thread. Throwing tells Go the callback failed, which keeps
/// the pending entry and stops reception; a destroyed JavaScript runtime is such a failure.
private final class NativeDeliveryEvents: NSObject, YYWhatsAppGoBridgeDeliveryEventsProtocol {
  func onDelivery(_ value: String?) throws {
    guard let emit = ConnectionRuntime.shared.emit,
          let value, let data = value.data(using: .utf8),
          let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          envelope["contractVersion"] as? Int == 1, envelope["event"] as? String == "messageReceived",
          let consumer = envelope["consumer"] as? String,
          let payload = envelope["payload"] as? [String: Any],
          let deliveryId = payload["deliveryId"] as? String,
          let message = payload["message"].flatMap(jsonValue) else {
      throw NSError(domain: "WhatsAppDelivery", code: 1)
    }
    emit("messageReceived", ["deliveryId": deliveryId, "message": message, "consumer": consumer])
  }
}

private final class NativeConnectionEvents: NSObject, YYWhatsAppGoBridgeConnectionEventsProtocol {
  private let lock = NSLock()
  private var active = true
  private var revoked = false

  func onConnectionEvent(_ value: String?) {
    lock.lock(); defer { lock.unlock() }
    guard active else { return }
    guard let value, let data = value.data(using: .utf8),
          let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          envelope["contractVersion"] as? Int == 1,
          let event = envelope["event"] as? String,
          ["qr", "connectionChanged", "error"].contains(event),
          let payload = envelope["payload"] as? [String: Any] else { return }
    if event == "connectionChanged", payload["state"] as? String == "sessionExpired" { revoked = true }
    ConnectionRuntime.shared.emit?(event, payload)
  }

  func retire() -> Bool {
    lock.lock(); defer { lock.unlock() }
    active = false
    return revoked
  }
}

private final class ConnectionRuntime {
  static let shared = ConnectionRuntime()
  let lock = NSRecursiveLock()
  var writer: NativeStateStore?
  var session: YYWhatsAppGoBridgeConnectionSession?
  var eventSink: NativeConnectionEvents?
  var prepared = false
  var revoked = false
  // emit is written by definition() and OnDestroy and read from Go callback threads and stop().
  // A leaf lock (never held while calling out or taking another lock) synchronizes every access
  // without waiting on `lock`, which initialize holds across native I/O.
  private let emitLock = NSLock()
  private var emitHandler: ((String, [String: Any]) -> Void)?
  var emit: ((String, [String: Any]) -> Void)? {
    get { emitLock.lock(); defer { emitLock.unlock() }; return emitHandler }
    set { emitLock.lock(); defer { emitLock.unlock() }; emitHandler = newValue }
  }
  var delivery: YYWhatsAppGoBridgeDeliverySession?
  var deliveryBudget: Int64 = 0
  var consumerToken: String?

  /// Recovery and confirmation need only the container, so this is open even when the session is invalid.
  func ensureDelivery(writer: NativeStateStore, recoveryBytes: Int64) -> String? {
    if delivery != nil && deliveryBudget == recoveryBytes { return nil }
    delivery?.close()
    delivery = nil
    let result = YYWhatsAppGoBridgeOpenDelivery(NativeDeliveryStorage(writer: writer), NativeDeliveryEvents(), recoveryBytes)
    guard let opened = result?.session, result?.code.isEmpty ?? false else { return bridgeCode(result?.code ?? "") }
    delivery = opened
    deliveryBudget = recoveryBytes
    if let consumerToken { _ = opened.setConsumer(consumerToken) }
    opened.start()
    return nil
  }

  func runtimeDestroyed() {
    emit = nil
    if let consumerToken { delivery?.removeConsumer(consumerToken) }
    consumerToken = nil
  }

  func openConnection(snapshot: [String: Any]) throws -> String? {
    if revoked { return "SESSION_EXPIRED" }
    guard let writer else { return "NOT_INITIALIZED" }
    if snapshot["session"] is [String: Any] && (try !writer.canRestoreSession()) { stop(); return "SESSION_STATE_INVALID" }
    if session != nil { return nil }
    let account = (snapshot["session"] as? [String: Any])?["accountId"] as? String ?? ""
    guard let options = snapshot["options"] as? [String: Any],
          let recovery = options["maxRecoveryBufferBytes"] as? Int else { return "SESSION_STATE_INVALID" }
    let generation = UUID().uuidString.lowercased()
    if account.isEmpty { try writer.registerFreshGeneration(generation) }
    else { try writer.registerGeneration(generation, accountId: account) }
    let sink = NativeConnectionEvents()
    let result = YYWhatsAppGoBridgeOpenConnectionWithDelivery(NativeProtocolStorage(writer: writer), sink, delivery, generation,
                                                  account, Int64(recovery), Int64(recovery))
    guard let result, result.code.isEmpty, let opened = result.session else {
      sink.retire()
      writer.retireGeneration()
      return bridgeCode(result?.code ?? "")
    }
    session = opened
    eventSink = sink
    return nil
  }

  func stop() {
    if eventSink?.retire() == true { revoked = true }
    eventSink = nil
    let hadSession = session != nil
    if session?.close() == true { revoked = true }
    writer?.retireGeneration()
    session = nil
    if hadSession { emit?("connectionChanged", ["state": "disconnected"]) }
  }
}

private func bridgeCode(_ code: String) -> String {
  switch code {
  case "INVALID_INPUT", "NOT_INITIALIZED", "SESSION_STATE_INVALID", "SESSION_STORAGE_FAILED", "SESSION_STORAGE_LIMIT_REACHED", "RECOVERY_BUFFER_FULL": return code
  default: return "NATIVE_CALL_FAILED"
  }
}

private func publicError(_ error: Error) -> String {
  guard let failure = error as? StateStoreError else { return "NATIVE_CALL_FAILED" }
  switch failure {
  case .invalidRequest: return "INVALID_INPUT"
  case .invalid: return "SESSION_STATE_INVALID"
  case .sessionLimit: return "SESSION_STORAGE_LIMIT_REACHED"
  case .bufferFull: return "RECOVERY_BUFFER_FULL"
  case .staleGeneration, .revision, .storage: return "SESSION_STORAGE_FAILED"
  }
}
private func failure(_ code: String) -> [String: Any] { ["success": false, "error": ["code": code]] }
private func success(_ data: Any = NSNull()) -> [String: Any] { ["success": true, "data": data] }

public class WhatsAppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatsApp")
    Events("qr", "connectionChanged", "messageReceived", "error")
    ConnectionRuntime.shared.emit = { [weak self] event, payload in self?.sendEvent(event, payload) }

    AsyncFunction("initialize") { (options: [String: Any]) -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); defer { runtime.lock.unlock() }
      do {
        if runtime.writer == nil { runtime.writer = try NativeStateStore() }
        guard let writer = runtime.writer else { return failure("MODULE_UNAVAILABLE") }
        var snapshot = try writer.open()
        guard Set(options.keys).isSubset(of: ["maxRecoveryBufferBytes", "maxImageStorageBytes"]),
              let saved = snapshot["options"] as? [String: Any] else { return failure("INVALID_INPUT") }
        let requested: [String: Any] = [
          "maxRecoveryBufferBytes": options["maxRecoveryBufferBytes"] ?? 10 * 1024 * 1024,
          "maxImageStorageBytes": options["maxImageStorageBytes"] ?? 50 * 1024 * 1024,
        ]
        for (_, raw) in requested {
          guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
                value.int64Value > 0, value.int64Value <= 9_007_199_254_740_991,
                value.doubleValue == Double(value.int64Value) else { return failure("INVALID_INPUT") }
        }
        guard let recovery = (requested["maxRecoveryBufferBytes"] as? NSNumber)?.int64Value,
              let image = (requested["maxImageStorageBytes"] as? NSNumber)?.int64Value else { return failure("INVALID_INPUT") }
        if recovery != (saved["maxRecoveryBufferBytes"] as? NSNumber)?.int64Value ||
           image != (saved["maxImageStorageBytes"] as? NSNumber)?.int64Value {
          if runtime.revoked { return failure("INVALID_INPUT") }
          if runtime.session?.canUpdateOptions() == false { return failure("INVALID_INPUT") }
          runtime.stop()
          _ = try writer.updateOptions(maxRecoveryBufferBytes: recovery, maxImageStorageBytes: image)
          snapshot = try writer.open()
        }
        runtime.prepared = true
        if let code = runtime.ensureDelivery(writer: writer, recoveryBytes: recovery) { return failure(code) }
        if runtime.revoked { return success(["state": "sessionExpired"]) }
        if let code = try runtime.openConnection(snapshot: snapshot) { return failure(code) }
        guard let session = runtime.session else { return failure("NATIVE_CALL_FAILED") }
        var data: [String: Any] = ["state": session.state()]
        if !session.currentQR().isEmpty, let bytes = session.currentQR().data(using: .utf8),
           let qr = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { data["qr"] = qr }
        return success(data)
      } catch { runtime.stop(); return failure(publicError(error)) }
    }

    AsyncFunction("connect") { () -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); defer { runtime.lock.unlock() }
      guard runtime.prepared, let writer = runtime.writer else { return failure("NOT_INITIALIZED") }
      do {
        if let code = try runtime.openConnection(snapshot: writer.open()) { return failure(code) }
        let code = runtime.session?.connect() ?? "NOT_INITIALIZED"
        return code.isEmpty ? success() : failure(code)
      } catch { runtime.stop(); return failure(publicError(error)) }
    }

    AsyncFunction("disconnect") { () -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); defer { runtime.lock.unlock() }
      guard runtime.prepared else { return failure("NOT_INITIALIZED") }
      runtime.stop()
      return success()
    }

    AsyncFunction("logout") { () -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); defer { runtime.lock.unlock() }
      guard runtime.prepared, let writer = runtime.writer else { return failure("NOT_INITIALIZED") }
      do {
        runtime.stop()
        let hadSession = try writer.open()["session"] is [String: Any]
        try writer.endSession()
        runtime.revoked = false
        return hadSession ? failure("REMOTE_LOGOUT_UNCONFIRMED") : success()
      } catch { return failure(publicError(error)) }
    }

    OnDestroy {
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); defer { runtime.lock.unlock() }
      runtime.runtimeDestroyed()
    }

    AsyncFunction("confirmMessageStored") { (id: String) -> [String: Any] in
      // The durable write runs on this background thread and outside the runtime lock.
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); let delivery = runtime.delivery; runtime.lock.unlock()
      guard let delivery else { return failure("NOT_INITIALIZED") }
      let code = delivery.confirm(id)
      return code.isEmpty ? success() : failure(bridgeCode(code))
    }
    AsyncFunction("setMessageConsumer") { (token: String) -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock(); runtime.consumerToken = token; let delivery = runtime.delivery; runtime.lock.unlock()
      guard let delivery else { return failure("NOT_INITIALIZED") }
      let code = delivery.setConsumer(token)
      return code.isEmpty ? success() : failure(bridgeCode(code))
    }
    AsyncFunction("removeMessageConsumer") { (token: String) -> [String: Any] in
      let runtime = ConnectionRuntime.shared
      runtime.lock.lock()
      if runtime.consumerToken == token { runtime.consumerToken = nil }
      let delivery = runtime.delivery
      runtime.lock.unlock()
      delivery?.removeConsumer(token)
      return success()
    }
    AsyncFunction("downloadImage") { (_: [String: Any]) -> [String: Any] in failure("NATIVE_CALL_FAILED") }
    AsyncFunction("deleteDownloadedImage") { (_: String) -> [String: Any] in failure("NATIVE_CALL_FAILED") }

    AsyncFunction("probe") { (value: String, failCallback: Bool) -> [String: String] in
      guard let result = YYWhatsAppGoBridgeProbe(ProbeStorage(fail: failCallback), value) else {
        return ["status": "error", "code": "NATIVE_CALL_FAILED"]
      }
      if !result.code.isEmpty { return ["status": "error", "code": result.code] }
      return ["status": "ok", "value": result.value]
    }
  }
}
