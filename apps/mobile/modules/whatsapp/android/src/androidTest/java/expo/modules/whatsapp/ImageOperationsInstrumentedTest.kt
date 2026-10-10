package expo.modules.whatsapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.whatsapp.go.bridge.Bridge
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
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
  // M3 / IT-IMG-14: admission (Go's queue position) follows call order, and the first call's
  // long wait does not delay the admission of the next one.
  @Test fun admissionFollowsCallOrderWhileTheFirstOperationStillWaits() = runBlocking {
    val admitted = CopyOnWriteArrayList<Int>()
    val firstMayFinish = CountDownLatch(1)
    val secondAdmitted = CountDownLatch(1)
    val calls = (1..2).map { n ->
      async {
        ImageOperations.run({ admitted.add(n); if (n == 2) secondAdmitted.countDown(); n }) { value ->
          if (value == 1) assertTrue("the second call was not admitted while the first waited", secondAdmitted.await(5, TimeUnit.SECONDS))
          firstMayFinish.countDown()
          value
        }
      }
    }
    assertEquals(listOf(1, 2), calls.map { it.outcome() })
    assertEquals(listOf(1, 2), admitted.toList())
  }

  // m6: however many calls are pending, no more than MAX_WAITERS threads wait, and the caller's
  // thread (Expo's queue) is never one of them.
  @Test fun waitersAreBoundedAndOffTheCaller() = runBlocking {
    val caller = Thread.currentThread()
    val running = AtomicInteger()
    val peak = AtomicInteger()
    val results = (1..12).map {
      async {
        ImageOperations.run({ it }) { value ->
          peak.accumulateAndGet(running.incrementAndGet()) { a, b -> maxOf(a, b) }
          Thread.sleep(20)
          running.decrementAndGet()
          Thread.currentThread() to value
        }
      }
    }.map { it.outcome() }
    assertTrue(peak.get() <= ImageOperations.MAX_WAITERS)
    results.forEach { assertNotEquals(caller, it.first) }
  }

  @Test fun bridgeRejectsAnInvalidDirectoryAndReferences() {
    assertTrue(Bridge.openImages("", 1024).code.isNotEmpty())
    val dir = File(File(System.getProperty("java.io.tmpdir")!!), "wa-images-" + System.nanoTime())
    val opened = Bridge.openImages(dir.path, 1024)
    assertEquals("", opened.code)
    val session = opened.session
    assertNotNull(session)
    assertEquals("INVALID_INPUT", session.beginDownload("wa-message:v1:x", "wa-image:v1:AAAA").outcome().code)
    assertEquals("INVALID_INPUT", session.beginDelete("../../etc/passwd").outcome().code)
    dir.deleteRecursively()
  }
}
