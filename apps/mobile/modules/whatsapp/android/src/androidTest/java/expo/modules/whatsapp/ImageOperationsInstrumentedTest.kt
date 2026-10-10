package expo.modules.whatsapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.whatsapp.go.bridge.Bridge
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** WA-10 source tests. Not compiled or run in this task: there is no Gradle, emulator or device here. */
@RunWith(AndroidJUnit4::class)
class ImageOperationsInstrumentedTest {
  // B1: two blocking image operations make progress together and off the calling thread, so a
  // stalled download cannot hold the queue that confirmations and disconnect use.
  @Test fun blockingOperationsRunConcurrentlyAndOffTheCaller() = runBlocking {
    val caller = Thread.currentThread()
    val both = CountDownLatch(2)
    val threads = (1..2).map {
      async {
        ImageOperations.run {
          both.countDown()
          assertTrue("operations were serialized", both.await(5, TimeUnit.SECONDS))
          Thread.currentThread()
        }
      }
    }.map { it.await() }
    threads.forEach { assertNotEquals(caller, it) }
  }

  @Test fun bridgeRejectsAnInvalidDirectoryAndReferences() {
    assertTrue(Bridge.openImages("", 1024).code.isNotEmpty())
    val dir = File(File(System.getProperty("java.io.tmpdir")!!), "wa-images-" + System.nanoTime())
    val opened = Bridge.openImages(dir.path, 1024)
    assertEquals("", opened.code)
    val session = opened.session
    assertNotNull(session)
    assertEquals("INVALID_INPUT", session.download("wa-message:v1:x", "wa-image:v1:AAAA").code)
    assertEquals("INVALID_INPUT", session.delete("../../etc/passwd"))
    dir.deleteRecursively()
  }
}
