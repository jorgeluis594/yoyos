package expo.modules.whatsapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BridgeInstrumentedTest {
  @Test fun goCallsNativeAndReturnsValue() {
    val result = Bridge.probe(object : Storage {
      override fun commit(value: String): String = "callback:$value"
    }, "{}")
    assertEquals("callback:{}", result)
  }

  @Test fun nativeErrorReturnsToGo() {
    assertThrows(Exception::class.java) {
      Bridge.probe(object : Storage {
        override fun commit(value: String): String = throw Exception("controlled failure")
      }, "{}")
    }
  }
}
