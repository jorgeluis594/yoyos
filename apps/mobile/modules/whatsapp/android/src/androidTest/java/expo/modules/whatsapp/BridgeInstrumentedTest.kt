package expo.modules.whatsapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BridgeInstrumentedTest {
  @Test fun goCallsNativeAndReturnsValue() {
    val result = Bridge.probe(object : Storage {
      override fun commit(value: String): String = "callback:$value"
    }, "{}")
    assertEquals("callback:{}", result.value)
    assertEquals("", result.code)
  }

  @Test fun nativeErrorReturnsToGo() {
    val result = Bridge.probe(object : Storage {
      override fun commit(value: String): String = throw Exception("controlled failure")
    }, "{}")
    assertEquals("NATIVE_CALL_FAILED", result.code)
    assertEquals("", result.value)
  }
}
