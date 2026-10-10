package expo.modules.whatsapp

import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Image operations can block for a whole download. They run here, never on Expo's shared serial
 * AsyncFunction queue, so confirmations, disconnect and logout do not wait for them.
 */
internal object ImageOperations {
  private val dispatcher = Executors.newCachedThreadPool { task ->
    Thread(task, "whatsapp-images").apply { isDaemon = true }
  }.asCoroutineDispatcher()

  suspend fun <T> run(block: () -> T): T = withContext(dispatcher) { block() }
}
