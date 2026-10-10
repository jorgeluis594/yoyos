package expo.modules.whatsapp

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * WA-12 durable receive intent (IT-AND-07, IT-AND-08, IT-AND-09, IT-CFG-03). Source only: it needs the
 * Android Keystore, so the task that wrote it did not execute it (no Gradle, emulator or device).
 */
@RunWith(AndroidJUnit4::class)
class ReceiveIntentInstrumentedTest {
  private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val protocol = "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray()
  private fun newRoot() = File(base.noBackupFilesDir, "state-test-${java.util.UUID.randomUUID()}")
  private fun store(root: File, fault: ((String) -> Unit)? = null) = NativeStateStore(
    object : ContextWrapper(base) { override fun getNoBackupFilesDir(): File = root },
    root.name.removePrefix("state-test-").replace("-", ""), fault,
  )

  @Test fun noIntentBeforeAnySession() {
    assertNull(store(newRoot()).receiveIntent())
  }

  // IT-AND-07: the intent and the session published by QR linking share one revision.
  @Test fun qrLinkingPublishesSessionAndIntentTogether() {
    val root = newRoot()
    val writer = store(root)
    writer.open()
    writer.beginSession("123@lid", protocol, armReceive = true)
    val recovered = store(root)
    assertEquals(ReceiveIntent(true, "123@lid"), recovered.receiveIntent())
    assertEquals("123@lid", recovered.open().getJSONObject("session").getString("accountId"))
  }

  // IT-AND-07 / IT-CFG-03: options persisted with the intent survive a new process, with no JavaScript.
  @Test fun optionsAndIntentSurviveRecreation() {
    val root = newRoot()
    val writer = store(root)
    writer.open()
    writer.updateOptions(20L * 1024 * 1024, 60L * 1024 * 1024)
    writer.beginSession("123@lid", protocol)
    writer.armReceiveIntent("123@lid")
    val recovered = store(root)
    assertEquals(ReceiveIntent(true, "123@lid"), recovered.receiveIntent())
    assertEquals(20L * 1024 * 1024, recovered.open().getJSONObject("options").getLong("maxRecoveryBufferBytes"))
  }

  // IT-AND-08: an intent for another account or without a session is refused, never restored.
  @Test fun armingRequiresTheStoredSessionAccount() {
    val root = newRoot()
    val writer = store(root)
    writer.open()
    assertThrows(StateFailure::class.java) { writer.armReceiveIntent("123@lid") }
    writer.beginSession("123@lid", protocol)
    assertThrows(StateFailure::class.java) { writer.armReceiveIntent("456@lid") }
    assertNull(writer.receiveIntent())
  }

  // IT-AND-09: the withdrawal is durable and idempotent; a restart sees the withdrawn intent.
  @Test fun withdrawalIsDurableAndIdempotent() {
    val root = newRoot()
    val writer = store(root)
    writer.open()
    writer.beginSession("123@lid", protocol, armReceive = true)
    writer.withdrawReceiveIntent()
    writer.withdrawReceiveIntent()
    assertEquals(ReceiveIntent(false, null), store(root).receiveIntent())
    assertEquals("123@lid", store(root).open().getJSONObject("session").getString("accountId")) // credentials stay
  }

  // IT-AND-09: when saving the withdrawal fails nothing claims persistence; the intent is still readable.
  @Test fun failedWithdrawalPropagatesAndLeavesTheIntentVisible() {
    val root = newRoot()
    var fail = false
    val writer = store(root) { point -> if (fail && point == "write") throw java.io.IOException("injected") }
    writer.open()
    writer.beginSession("123@lid", protocol, armReceive = true)
    fail = true
    assertThrows(StateFailure::class.java) { writer.withdrawReceiveIntent() }
    fail = false
    assertEquals(ReceiveIntent(true, "123@lid"), store(root).receiveIntent())
    writer.withdrawReceiveIntent() // the retry succeeds
    assertEquals(ReceiveIntent(false, null), store(root).receiveIntent())
  }

  // WA-09 / IT-AND-08: logout keeps the withdrawal; ending the session clears the whole field.
  @Test fun logoutClearsTheIntentWithTheSession() {
    val root = newRoot()
    val writer = store(root)
    writer.open()
    writer.beginSession("123@lid", protocol, armReceive = true)
    writer.endSession()
    assertNull(store(root).receiveIntent())
  }
}
