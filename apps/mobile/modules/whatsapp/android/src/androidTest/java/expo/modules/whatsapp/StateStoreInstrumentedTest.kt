package expo.modules.whatsapp

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class StateStoreInstrumentedTest {
  private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val freshRoot get() = File(base.noBackupFilesDir, "state-test-${java.util.UUID.randomUUID()}")
  private fun contextFor(root: File) = object : ContextWrapper(base) {
    override fun getNoBackupFilesDir(): File = root
  }
  private fun directory(root: File) = File(root, "whatsapp")
  private fun makeStore(root: File, fault: ((String) -> Unit)? = null) =
    NativeStateStore(contextFor(root), root.name.removePrefix("state-test-").replace("-", ""), fault)

  @Test fun strictJsonRejectsDuplicateKeysAndMalformedNumbers() {
    for (value in listOf("{\"a\":1,\"a\":2}", "{\"a\":1,\"\\u0061\":2}", "{\"a\":01}", "{\"a\":1,}")) {
      assertThrows(StateFailure::class.java) { StrictJson.check(value) }
    }
    StrictJson.check("{\"a\":[true,null,3]}")
  }

  @Test fun publishedStateSurvivesRestartAndIgnoresPreparation() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    assertEquals(true, File(directory(root), "images").isDirectory)
    val revision = currentRevision(root)
    store.commit(revision) { it.getJSONObject("options").put("maxRecoveryBufferBytes", 20L * 1024 * 1024); it }
    File(directory(root), "state.next").writeText("uncommitted")
    val recovered = makeStore(root).open()
    assertEquals(20L * 1024 * 1024, recovered.getJSONObject("options").getLong("maxRecoveryBufferBytes"))
    assertFalse(File(directory(root), "state.next").exists())
  }

  @Test fun recoveryOnlyCommitPreservesSessionCiphertext() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val original = store.open().getJSONObject("session").getString("ciphertextBase64")
    val next = store.commit(currentRevision(root)) { it }
    assertEquals(original, next.getJSONObject("session").getString("ciphertextBase64"))
    assertEquals(true, makeStore(root).canRestoreSession())
    val firstKey = store.open().getJSONObject("session").getString("sessionKeyId")
    val firstNonce = store.open().getJSONObject("session").getString("nonceBase64")
    store.endSession()
    assertEquals(org.json.JSONObject.NULL, makeStore(root).open().get("session"))
    store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    assertEquals(false, firstKey == store.open().getJSONObject("session").getString("sessionKeyId"))
    assertEquals(false, firstNonce == store.open().getJSONObject("session").getString("nonceBase64"))
  }

  @Test fun interruptedCreationResumesWithoutPromotingPreparation() {
    for (phase in listOf("creationRecord", "recoveryKey", "initialPublication")) {
      val root = freshRoot
      assertThrows(StateFailure::class.java) {
        makeStore(root) { if (it == phase) throw StateFailure("STORAGE_FAILED") }.open()
      }
      val recovered = makeStore(root).open()
      assertEquals(org.json.JSONObject.NULL, recovered.get("session"))
      assertEquals("0", currentRevision(root))
    }
  }

  @Test fun provisionalSessionRecoveryKeepsOnlyPublishedSession() {
    for (phase in listOf("provisionalRecord", "sessionKey", "sessionPublished")) {
      val root = freshRoot
      var active = false
      val store = makeStore(root) { if (active && it == phase) throw StateFailure("STORAGE_FAILED") }
      store.open(); active = true
      assertThrows(StateFailure::class.java) {
        store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
      }
      val recovered = makeStore(root).open()
      assertEquals(phase == "sessionPublished", recovered.get("session") != org.json.JSONObject.NULL)
    }
  }

  @Test fun injectedPublicationFailuresPreserveAReadableRevision() {
    for (phase in listOf("cipher", "write", "sync", "close", "replace", "directorySync", "response")) {
      val root = freshRoot
      var active = false
      val store = makeStore(root) { reached ->
        if (active && reached == phase) throw StateFailure("STORAGE_FAILED")
      }
      store.open()
      active = true
      assertThrows(StateFailure::class.java) { store.commit("0") { it } }
      val expected = if (phase == "directorySync" || phase == "response") "1" else "0"
      assertEquals(expected, currentRevision(root))
      makeStore(root).open()
    }
  }

  @Test fun pendingRemainsReadableWithoutSessionKey() {
    val root = freshRoot
    val writer = makeStore(root)
    writer.open()
    writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val id = writer.open().getJSONObject("session").getString("sessionKeyId")
    writer.commit("1") { state ->
      state.getJSONArray("pending").put(org.json.JSONObject()
        .put("deliveryId", "wa-delivery:v1:" + "a".repeat(32)).put("accountId", "123@lid")
        .put("createdRevision", "2").put("createdOrdinal", 0).put("source", "live")
        .put("identityState", "pendingLid")
        .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}").put("items", org.json.JSONArray())))
      state
    }
    val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    keyStore.deleteEntry("yoyos.whatsapp.test.${root.name.removePrefix("state-test-").replace("-", "")}.key.$id")
    val recovered = makeStore(root)
    assertEquals(1, recovered.open().getJSONArray("pending").length())
    assertEquals(false, recovered.canRestoreSession())
  }

  @Test fun interruptedRetirementCompletesBeforeAnotherSession() {
    for (phase in listOf("retiredPublished", "deleteSessionKey", "keyDeleted")) {
      val root = freshRoot
      var active = false
      val writer = makeStore(root) { if (active && it == phase) throw StateFailure("STORAGE_FAILED") }
      writer.open()
      writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
      active = true
      assertThrows(StateFailure::class.java) { writer.endSession() }
      val recovered = makeStore(root)
      val state = recovered.open()
      assertEquals(org.json.JSONObject.NULL, state.get("session"))
      assertEquals(0, state.getJSONArray("sessionKeysToDelete").length())
      recovered.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    }
  }

  @Test fun realFilesystemFailureCannotReplacePublishedState() {
    val root = freshRoot
    val writer = makeStore(root)
    writer.open()
    val next = File(directory(root), "state.next")
    assertEquals(true, next.mkdir())
    File(next, "occupied").writeText("x")
    assertThrows(StateFailure::class.java) { writer.commit("0") { it } }
    assertEquals("0", currentRevision(root))
  }

  @Test fun staleRevisionDoesNotReplacePublishedState() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    val old = currentRevision(root)
    store.commit(old) { it }
    assertThrows(StateFailure::class.java) { store.commit(old) { it } }
    makeStore(root).open()
  }

  @Test fun corruptedPublicationDoesNotBecomeEmptyInstallation() {
    val root = freshRoot
    makeStore(root).open()
    val file = File(directory(root), "state.bin")
    val bytes = file.readBytes(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte(); file.writeBytes(bytes)
    assertThrows(Exception::class.java) { makeStore(root).open() }
  }

  private fun currentRevision(root: File): String {
    val bytes = File(directory(root), "state.bin").readBytes()
    val length = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
    return org.json.JSONObject(String(bytes, 12, length, Charsets.UTF_8)).getString("revision")
  }
}
