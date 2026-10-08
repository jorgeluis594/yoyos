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
