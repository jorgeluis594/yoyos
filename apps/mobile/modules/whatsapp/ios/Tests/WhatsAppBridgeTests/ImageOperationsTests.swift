import XCTest
import WhatsAppGo
import WhatsAppStateStore

/// WA-10 source tests. Not compiled or run in this task: there is no Xcode or simulator here.
final class ImageOperationsTests: XCTestCase {
  // M3 / IT-IMG-14: admission (Go's queue position) follows call order, and the first call's long
  // wait does not delay the admission of the next one.
  func testAdmissionFollowsCallOrderWhileTheFirstOperationStillWaits() {
    let lock = NSLock()
    var admitted: [Int] = []
    let secondAdmitted = DispatchSemaphore(value: 0)
    let done = expectation(description: "both completed")
    done.expectedFulfillmentCount = 2
    for n in 1...2 {
      ImageOperations.submit(begin: { () -> Int in
        lock.lock(); admitted.append(n); lock.unlock()
        if n == 2 { secondAdmitted.signal() }
        return n
      }, wait: { (value: Int) -> Int in
        if value == 1 { XCTAssertEqual(secondAdmitted.wait(timeout: .now() + 5), .success, "the second call was not admitted while the first waited") }
        return value
      }, completion: { _ in done.fulfill() })
    }
    wait(for: [done], timeout: 10)
    XCTAssertEqual(admitted, [1, 2])
  }

  // m6: however many calls are pending, no more than maxWaiters threads wait.
  func testWaitersAreBounded() {
    let lock = NSLock()
    var running = 0, peak = 0
    let done = expectation(description: "all completed")
    done.expectedFulfillmentCount = 12
    for n in 1...12 {
      ImageOperations.submit(begin: { n }, wait: { (_: Int) -> Int in
        lock.lock(); running += 1; peak = max(peak, running); lock.unlock()
        Thread.sleep(forTimeInterval: 0.02)
        lock.lock(); running -= 1; lock.unlock()
        return n
      }, completion: { _ in done.fulfill() })
    }
    wait(for: [done], timeout: 10)
    XCTAssertLessThanOrEqual(peak, ImageOperations.maxWaiters)
  }

  func testBridgeRejectsInvalidDirectoryAndReferences() throws {
    XCTAssertFalse(YYWhatsAppGoBridgeOpenImages("", 1024)?.code.isEmpty ?? true)
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("wa-images-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let opened = YYWhatsAppGoBridgeOpenImages(dir.path, 1024)
    XCTAssertEqual(opened?.code, "")
    let session = try XCTUnwrap(opened?.session)
    XCTAssertEqual(session.beginDownload("wa-message:v1:x", downloadReference: "wa-image:v1:AAAA")?.outcome()?.code, "INVALID_INPUT")
    XCTAssertEqual(session.beginDelete("../../etc/passwd")?.outcome()?.code, "INVALID_INPUT")
  }
}
