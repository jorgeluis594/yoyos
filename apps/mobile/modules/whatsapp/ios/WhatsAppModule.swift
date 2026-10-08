import ExpoModulesCore
import WhatsAppGo

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

public class WhatsAppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatsApp")

    AsyncFunction("probe") { (value: String, failCallback: Bool) -> [String: String] in
      guard let result = YYWhatsAppGoBridgeProbe(ProbeStorage(fail: failCallback), value) else {
        return ["status": "error", "code": "NATIVE_CALL_FAILED"]
      }
      if !result.code.isEmpty { return ["status": "error", "code": result.code] }
      return ["status": "ok", "value": result.value]
    }
  }
}
