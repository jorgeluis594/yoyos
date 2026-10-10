package expo.modules.whatsapp

import android.content.ContextWrapper
import android.os.Process
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class StateStoreCrashInstrumentedTest {
  private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val phase get() = InstrumentationRegistry.getArguments().getString("phase")
  private val runId get() = InstrumentationRegistry.getArguments().getString("runId")
  private fun root(phase: String, runId: String): File {
    val suffix = MessageDigest.getInstance("SHA-256").digest("$runId:$phase".toByteArray())
      .take(16).joinToString("") { "%02x".format(it) }
    return File(base.noBackupFilesDir, "state-test-$suffix")
  }
  private fun store(root: File, fault: ((String) -> Unit)? = null): NativeStateStore {
    val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = root }
    return NativeStateStore(context, root.name.removePrefix("state-test-"), fault)
  }

  @Test fun crashAtPublicationBoundary() {
    val phase = phase ?: return
    val root = root(phase, requireNotNull(runId))
    var active = false
    val writer = store(root) { reached ->
      if (active && reached == phase) {
        val marker = File(root, "crashed")
        FileOutputStream(marker).use { it.write(phase.toByteArray()); it.fd.sync() }
        Process.killProcess(Process.myPid())
        Runtime.getRuntime().halt(137)
      }
    }
    writer.open()
    writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val sessionId = writer.open().getJSONObject("session").getString("sessionKeyId")
    active = true
    writer.commit("1") {
      val pending = org.json.JSONObject().put("deliveryId", "wa-delivery:v1:" + "a".repeat(32))
        .put("accountId", "123@lid").put("createdRevision", "2").put("createdOrdinal", 0)
        .put("source", "live").put("identityState", "pendingLid")
        .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}").put("items", org.json.JSONArray()))
      it.put("session", org.json.JSONObject.NULL).put("sessionKeysToDelete", org.json.JSONArray().put(sessionId))
        .put("pending", org.json.JSONArray().put(pending))
      it.getJSONObject("options").put("maxImageStorageBytes", 123)
      it
    }
    fail("Crash phase was not reached: $phase")
  }

  @Test fun recoverAfterPublicationCrash() {
    val phase = phase ?: return
    val root = root(phase, requireNotNull(runId))
    assertEquals(phase, File(root, "crashed").readText())
    val recovered = store(root).open()
    val replaced = phase == "directorySync" || phase == "response"
    assertEquals(if (replaced) 123L else 50L * 1024 * 1024, recovered.getJSONObject("options").getLong("maxImageStorageBytes"))
    assertEquals(replaced, recovered.opt("session") == org.json.JSONObject.NULL)
    assertEquals(if (replaced) 1 else 0, recovered.getJSONArray("pending").length())
    assertEquals(0, recovered.getJSONArray("sessionKeysToDelete").length())
    if (replaced) assertEquals("2", recovered.getJSONArray("pending").getJSONObject(0).getString("createdRevision"))
    else assertEquals(true, store(root).canRestoreSession())
    assertFalse(File(root, "whatsapp/state.next").exists())
  }
}
