import Foundation

/// Image operations can block for a whole download, so they never run on Expo's shared serial
/// AsyncFunction queue: confirmations, disconnect and logout do not wait for them.
///
/// Their ORDER still matters (download(X) then delete(X) must stay in that order), and Go fixes it
/// when an operation is admitted. So admission is one dedicated serial queue that only calls
/// `begin` (non-blocking: it validates and takes a queue position) and hands the long `wait` to an
/// operation queue with a fixed width, added from that same queue. Waiters therefore start in
/// admission order, at most `maxWaiters` threads wait however many calls are pending, and a
/// stalled transfer never delays the admission of the next call.
public enum ImageOperations {
  public static let maxWaiters = 4
  public static let admission = DispatchQueue(label: "expo.modules.whatsapp.images.admission", qos: .userInitiated)
  public static let waiters: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "expo.modules.whatsapp.images.wait"
    queue.maxConcurrentOperationCount = maxWaiters
    queue.qualityOfService = .userInitiated
    return queue
  }()

  public static func submit<O, R>(begin: @escaping () -> O, wait: @escaping (O) -> R, completion: @escaping (R) -> Void) {
    admission.async {
      let operation = begin()
      waiters.addOperation { completion(wait(operation)) }
    }
  }
}
