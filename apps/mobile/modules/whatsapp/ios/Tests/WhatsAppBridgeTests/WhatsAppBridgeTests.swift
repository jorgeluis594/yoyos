import XCTest
import WhatsAppGo

private final class Storage: NSObject, YYWhatsAppGoBridgeStorageProtocol {
  var fail = false

  func commit(_ value: String?) throws -> String {
    if fail { throw NSError(domain: "WhatsAppBridgeTests", code: 1) }
    return "callback:\(value ?? "")"
  }
}

final class WhatsAppBridgeTests: XCTestCase {
  func testCallbackValueAndError() throws {
    let storage = Storage()
    XCTAssertEqual(try YYWhatsAppGoBridgeProbe(storage, "{}"), "callback:{}")
    storage.fail = true
    XCTAssertThrowsError(try YYWhatsAppGoBridgeProbe(storage, "{}"))
  }
}
