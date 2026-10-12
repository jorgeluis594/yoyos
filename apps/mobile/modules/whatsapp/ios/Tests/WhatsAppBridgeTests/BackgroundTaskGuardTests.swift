import XCTest
import WhatsAppStateStore

/// WA-13 source tests. Not compiled or run in this task: there is no Xcode or simulator here.
final class BackgroundTaskGuardTests: XCTestCase {
  func testWorkFinishingEndsTheTaskOnce() {
    var ended: [Int] = []
    let task = BackgroundTaskGuard(begin: { _ in 7 }, end: { ended.append($0) })
    task.end()
    task.end()
    XCTAssertEqual(ended, [7])
  }

  func testExpirationThenWorkEndsTheTaskOnce() {
    var ended: [Int] = []
    var expire: (() -> Void)?
    let task = BackgroundTaskGuard(begin: { expire = $0; return 3 }, end: { ended.append($0) })
    expire?()
    task.end()
    XCTAssertEqual(ended, [3])
  }

  func testExpirationDuringBeginStillEndsTheTask() {
    var ended: [Int] = []
    _ = BackgroundTaskGuard(begin: { handler in handler(); return 9 }, end: { ended.append($0) })
    XCTAssertEqual(ended, [9])
  }
}
