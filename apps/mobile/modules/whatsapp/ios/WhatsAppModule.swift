import ExpoModulesCore
import WhatsAppGo

private final class ProbeStorage: NSObject, YYWhatsAppGoBridgeStorage {
  let fail: Bool

  init(fail: Bool) { self.fail = fail }

  func commit(_ value: String?) throws -> String {
    if fail { throw NSError(domain: "WhatsAppProbe", code: 1) }
    return value ?? ""
  }
}

public class WhatsAppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhatsApp")

    AsyncFunction("probe") { (value: String, failCallback: Bool) -> [String: String] in
      do {
        return ["status": "ok", "value": try YYWhatsAppGoBridgeProbe(ProbeStorage(fail: failCallback), value)]
      } catch {
        return ["status": "error", "code": "NATIVE_CALL_FAILED"]
      }
    }
  }
}
