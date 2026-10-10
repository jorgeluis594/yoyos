import XCTest
import WhatsAppGo
import WhatsAppStateStore

/// WA-10 source tests. Not compiled or run in this task: there is no Xcode or simulator here.
final class ImageOperationsTests: XCTestCase {
  // B1: two blocking image operations make progress together, so a stalled download cannot hold
  // the queue confirmations and disconnect use.
  func testBlockingOperationsRunConcurrently() {
    let arrived = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let finished = expectation(description: "both operations ran together")
    finished.expectedFulfillmentCount = 2
    for _ in 0..<2 {
      ImageOperations.queue.async {
        arrived.signal()
        if release.wait(timeout: .now() + 5) == .success { finished.fulfill() }
      }
    }
    XCTAssertEqual(arrived.wait(timeout: .now() + 5), .success)
    XCTAssertEqual(arrived.wait(timeout: .now() + 5), .success, "the second operation was serialized behind the first")
    release.signal(); release.signal()
    wait(for: [finished], timeout: 5)
  }

  func testBridgeRejectsInvalidDirectoryAndReferences() throws {
    XCTAssertFalse(YYWhatsAppGoBridgeOpenImages("", 1024)?.code.isEmpty ?? true)
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("wa-images-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let opened = YYWhatsAppGoBridgeOpenImages(dir.path, 1024)
    XCTAssertEqual(opened?.code, "")
    let session = try XCTUnwrap(opened?.session)
    XCTAssertEqual(session.download("wa-message:v1:x", downloadReference: "wa-image:v1:AAAA")?.code, "INVALID_INPUT")
    XCTAssertEqual(session.delete("../../etc/passwd"), "INVALID_INPUT")
  }
}
