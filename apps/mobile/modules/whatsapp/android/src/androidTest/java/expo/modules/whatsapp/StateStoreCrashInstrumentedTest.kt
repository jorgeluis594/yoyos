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
  private fun root(phase: String): File {
    val suffix = MessageDigest.getInstance("SHA-256").digest(phase.toByteArray())
      .take(16).joinToString("") { "%02x".format(it) }
    return File(base.noBackupFilesDir, "state-test-$suffix")
  }
  private fun store(root: File, fault: ((String) -> Unit)? = null): NativeStateStore {
    val context = object : ContextWrapper(base) { override fun getNoBackupFilesDir() = root }
    return NativeStateStore(context, root.name.removePrefix("state-test-"), fault)
  }

  @Test fun crashAtPublicationBoundary() {
    val phase = phase ?: return
    val root = root(phase)
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
    active = true
    writer.commit("0") { it.getJSONObject("options").put("maxImageStorageBytes", 123); it }
    fail("Crash phase was not reached: $phase")
  }

  @Test fun recoverAfterPublicationCrash() {
    val phase = phase ?: return
    val root = root(phase)
    assertEquals(phase, File(root, "crashed").readText())
    val recovered = store(root).open()
    val expected = if (phase == "directorySync" || phase == "response") 123L else 50L * 1024 * 1024
    assertEquals(expected, recovered.getJSONObject("options").getLong("maxImageStorageBytes"))
    assertFalse(File(root, "whatsapp/state.next").exists())
  }
}
