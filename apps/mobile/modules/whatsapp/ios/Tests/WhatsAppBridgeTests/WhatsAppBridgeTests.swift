import XCTest
import WhatsAppGo

private final class Storage: NSObject, YYWhatsAppGoBridgeStorageProtocol {
  var fail = false

  func commit(_ value: String?, error: NSErrorPointer) -> String {
    if fail {
      error?.pointee = NSError(domain: "WhatsAppBridgeTests", code: 1)
      return ""
    }
    return "callback:\(value ?? "")"
  }
}

final class WhatsAppBridgeTests: XCTestCase {
  func testCallbackValueAndError() {
    let storage = Storage()
    let value = YYWhatsAppGoBridgeProbe(storage, "{}")
    XCTAssertEqual(value?.value, "callback:{}")
    XCTAssertEqual(value?.code, "")
    storage.fail = true
    let error = YYWhatsAppGoBridgeProbe(storage, "{}")
    XCTAssertEqual(error?.code, "NATIVE_CALL_FAILED")
    XCTAssertEqual(error?.value, "")
  }
}
