package expo.modules.whatsapp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage

class WhatsAppModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WhatsApp")

    AsyncFunction("probe") { value: String, failCallback: Boolean ->
      try {
        val result = Bridge.probe(object : Storage {
          override fun commit(value: String): String {
            if (failCallback) throw Exception("probe callback failed")
            return value
          }
        }, value)
        when {
          result == null -> mapOf("status" to "error", "code" to "NATIVE_CALL_FAILED")
          result.code.isNotEmpty() -> mapOf("status" to "error", "code" to result.code)
          else -> mapOf("status" to "ok", "value" to result.value)
        }
      } catch (_: Exception) {
        mapOf("status" to "error", "code" to "NATIVE_CALL_FAILED")
      }
    }
  }
}
