import Foundation
#if os(iOS)
import UIKit
#endif

/// Wraps one background task so it ends exactly once, whether the work finished or the system called
/// the expiration handler first. Begin/end are injected so the ordering is testable without UIKit.
public final class BackgroundTaskGuard {
  private let lock = NSLock()
  private let endTask: (Int) -> Void
  private var identifier: Int?
  private var finished = false

  /// `begin` receives the expiration handler and returns the system's task identifier.
  public init(begin: (@escaping () -> Void) -> Int, end: @escaping (Int) -> Void) {
    endTask = end
    let started = begin { [weak self] in self?.end() }
    lock.lock()
    if finished {
      lock.unlock()
      end(started) // expired before the identifier was stored
    } else {
      identifier = started
      lock.unlock()
    }
  }

  public func end() {
    lock.lock()
    let current = identifier
    identifier = nil
    finished = true
    lock.unlock()
    if let current { endTask(current) }
  }

  /// The real UIApplication task; a no-op guard outside iOS.
  public static func application(name: String) -> BackgroundTaskGuard {
    #if os(iOS)
    return BackgroundTaskGuard(
      begin: { handler in UIApplication.shared.beginBackgroundTask(withName: name, expirationHandler: handler).rawValue },
      end: { UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: $0)) })
    #else
    return BackgroundTaskGuard(begin: { _ in 0 }, end: { _ in })
    #endif
  }
}
