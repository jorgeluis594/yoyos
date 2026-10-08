package expo.modules.whatsapp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage
import expo.modules.whatsapp.go.bridge.ProtocolStorage
import expo.modules.whatsapp.go.bridge.ProtocolSession
import expo.modules.whatsapp.go.bridge.FirstLinkSession

private fun protocolStorage(writer: NativeStateStore) = object : ProtocolStorage {
  override fun readState(request: String): String = writer.readProtocolState(request)
  override fun applyChanges(request: String): String = writer.applyProtocolChanges(request)
  override fun beginFreshSession(request: String): String = writer.beginFreshProtocolSession(request)
}

internal fun openProtocolSession(
  writer: NativeStateStore, generationId: String, accountId: String,
  readRecoveryBytes: Long, newRecoveryBytes: Long,
): ProtocolSession {
  writer.registerGeneration(generationId, accountId)
  val result = Bridge.openProtocolStore(protocolStorage(writer), generationId, accountId, readRecoveryBytes, newRecoveryBytes)
  if (result?.session == null) {
    writer.retireGeneration()
    throw StateFailure(result?.code ?: "STORAGE_FAILED")
  }
  return result.session
}

internal fun openFreshProtocolSession(
  writer: NativeStateStore, generationId: String,
  readRecoveryBytes: Long, newRecoveryBytes: Long,
): FirstLinkSession {
  writer.registerFreshGeneration(generationId)
  val result = Bridge.newFirstLinkProtocolStore(protocolStorage(writer), generationId, readRecoveryBytes, newRecoveryBytes)
  if (result?.session == null) {
    writer.retireGeneration()
    throw StateFailure(result?.code ?: "STORAGE_FAILED")
  }
  return result.session
}

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
