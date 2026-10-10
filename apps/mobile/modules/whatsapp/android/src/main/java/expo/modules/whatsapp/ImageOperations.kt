package expo.modules.whatsapp

import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * Image operations can block for a whole download, so they never run on Expo's shared serial
 * AsyncFunction queue: confirmations, disconnect and logout do not wait for them.
 *
 * Their ORDER still matters (download(X) then delete(X) must stay in that order), and Go fixes it
 * when an operation is admitted. So admission is one dedicated thread that only calls `begin`
 * (non-blocking: it validates and takes a queue position) and hands the long `wait` to a small
 * fixed pool, submitted from that same thread. Waiters therefore start in admission order, at
 * most [MAX_WAITERS] threads exist however many calls are pending, and a stalled transfer never
 * delays the admission of the next call.
 */
internal object ImageOperations {
  const val MAX_WAITERS = 4

  private val admission = Executors.newSingleThreadExecutor { task ->
    Thread(task, "whatsapp-images-admission").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  private val waiters = Executors.newFixedThreadPool(MAX_WAITERS) { task ->
    Thread(task, "whatsapp-images-wait").apply { isDaemon = true }
  }

  suspend fun <O, R> run(begin: () -> O, wait: (O) -> R): R {
    val future = withContext(admission) {
      val operation = begin()
      val result = CompletableFuture<R>()
      waiters.execute {
        try { result.complete(wait(operation)) } catch (error: Throwable) { result.completeExceptionally(error) }
      }
      result
    }
    return suspendCancellableCoroutine { continuation ->
      future.whenComplete { value, error ->
        if (error != null) continuation.resumeWithException(error) else continuation.resume(value)
      }
    }
  }
}
