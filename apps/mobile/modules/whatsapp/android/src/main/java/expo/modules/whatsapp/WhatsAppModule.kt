package expo.modules.whatsapp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage
import expo.modules.whatsapp.go.bridge.ProtocolStorage
import expo.modules.whatsapp.go.bridge.ProtocolSession
import expo.modules.whatsapp.go.bridge.ConnectionEvents
import expo.modules.whatsapp.go.bridge.ConnectionSession
import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal fun openProtocolSession(
  writer: NativeStateStore, generationId: String, accountId: String,
  readRecoveryBytes: Long, newRecoveryBytes: Long,
): ProtocolSession {
  writer.registerGeneration(generationId, accountId)
  val result = Bridge.openProtocolStore(object : ProtocolStorage {
    override fun readState(request: String): String = writer.readProtocolState(request)
    override fun applyChanges(request: String): String = writer.applyProtocolChanges(request)
    override fun beginFreshSession(request: String): String = writer.beginFreshProtocolSession(request)
  }, generationId, accountId, readRecoveryBytes, newRecoveryBytes)
  if (result?.session == null) {
    writer.retireGeneration()
    throw StateFailure(result?.code ?: "STORAGE_FAILED")
  }
  return result.session
}

private class PublicConnectionEvents(private val forward: (String, Map<String, Any?>) -> Unit) : ConnectionEvents {
  private var active = true
  override fun onConnectionEvent(value: String) {
    synchronized(this) {
      if (!active) return
      try {
        val envelope = JSONObject(value)
        if (envelope.getInt("contractVersion") != 1) return
        val event = envelope.getString("event")
        if (event !in setOf("qr", "connectionChanged", "error")) return
        val payload = envelope.getJSONObject("payload")
        forward(event, payload.keys().asSequence().associateWith { payload.get(it) })
      } catch (_: Exception) { /* Invalid native events never reach JavaScript. */ }
    }
  }
  fun retire() { synchronized(this) { active = false } }
}

private object ConnectionRuntime {
  val lock = Any()
  var writer: NativeStateStore? = null
  var session: ConnectionSession? = null
  var eventSink: PublicConnectionEvents? = null
  var prepared = false
  var emit: ((String, Map<String, Any?>) -> Unit)? = null

  fun openConnection(context: Context, snapshot: JSONObject): String? {
    val store = writer ?: NativeStateStore(context).also { writer = it }
    if (snapshot.optJSONObject("session") != null && !store.canRestoreSession()) { stop(); return "SESSION_STATE_INVALID" }
    if (session != null) return null
    val account = snapshot.optJSONObject("session")?.getString("accountId") ?: ""
    val generation = UUID.randomUUID().toString()
    val limits = snapshot.getJSONObject("options")
    val recovery = limits.getLong("maxRecoveryBufferBytes")
    try {
      if (account.isEmpty()) store.registerFreshGeneration(generation) else store.registerGeneration(generation, account)
      val sink = PublicConnectionEvents { event, fields -> emit?.invoke(event, fields) }
      val result = Bridge.openConnection(object : ProtocolStorage {
        override fun readState(request: String): String = store.readProtocolState(request)
        override fun applyChanges(request: String): String = store.applyProtocolChanges(request)
        override fun beginFreshSession(request: String): String = store.beginFreshProtocolSession(request)
      }, sink, generation, account, recovery, recovery)
      if (result?.session == null) {
        sink.retire()
        store.retireGeneration()
        return bridgeCode(result?.code ?: "")
      }
      session = result.session
      eventSink = sink
      return null
    } catch (error: Exception) {
      store.retireGeneration()
      return publicError(error)
    }
  }

  fun stop() {
    eventSink?.retire()
    eventSink = null
    val hadSession = session != null
    session?.close()
    writer?.retireGeneration()
    session = null
    if (hadSession) emit?.invoke("connectionChanged", mapOf("state" to "disconnected"))
  }
}

private fun publicError(error: Exception): String = when ((error as? StateFailure)?.code) {
  "INVALID_INPUT", "INVALID_REQUEST" -> "INVALID_INPUT"
  "SESSION_STATE_INVALID", "STATE_INVALID" -> "SESSION_STATE_INVALID"
  "SESSION_STORAGE_LIMIT_REACHED", "SESSION_FULL" -> "SESSION_STORAGE_LIMIT_REACHED"
  "BUFFER_FULL" -> "RECOVERY_BUFFER_FULL"
  "STORAGE_FAILED", "STALE_GENERATION", "SESSION_REVISION_MISMATCH" -> "SESSION_STORAGE_FAILED"
  else -> "NATIVE_CALL_FAILED"
}
private fun bridgeCode(code: String): String = when (code) {
  "INVALID_INPUT", "SESSION_STATE_INVALID", "SESSION_STORAGE_FAILED", "SESSION_STORAGE_LIMIT_REACHED", "RECOVERY_BUFFER_FULL" -> code
  else -> "NATIVE_CALL_FAILED"
}
private fun failure(code: String): Map<String, Any?> = mapOf("success" to false, "error" to mapOf("code" to code))
private fun success(data: Any? = null): Map<String, Any?> = mapOf("success" to true, "data" to data)

class WhatsAppModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WhatsApp")
    Events("qr", "connectionChanged", "messageReceived", "error")
    ConnectionRuntime.emit = { event, payload -> this@WhatsAppModule.sendEvent(event, payload) }

    AsyncFunction("initialize") { options: Map<String, Any?> ->
      synchronized(ConnectionRuntime.lock) {
        try {
          val context = appContext.reactContext ?: return@synchronized failure("MODULE_UNAVAILABLE")
          val writer = ConnectionRuntime.writer ?: NativeStateStore(context).also { ConnectionRuntime.writer = it }
          var snapshot = writer.open()
          if (options.keys.any { it !in setOf("maxRecoveryBufferBytes", "maxImageStorageBytes") }) return@synchronized failure("INVALID_INPUT")
          val saved = snapshot.getJSONObject("options")
          val requested = mapOf(
            "maxRecoveryBufferBytes" to (options["maxRecoveryBufferBytes"] ?: 10L * 1024 * 1024),
            "maxImageStorageBytes" to (options["maxImageStorageBytes"] ?: 50L * 1024 * 1024),
          )
          for ((key, raw) in requested) {
            val value = raw as? Number ?: return@synchronized failure("INVALID_INPUT")
            val integer = value.toLong()
            if (integer <= 0 || integer > 9007199254740991L || integer.toDouble() != value.toDouble()) return@synchronized failure("INVALID_INPUT")
          }
          val recovery = (requested["maxRecoveryBufferBytes"] as Number).toLong()
          val image = (requested["maxImageStorageBytes"] as Number).toLong()
          if (recovery != saved.getLong("maxRecoveryBufferBytes") || image != saved.getLong("maxImageStorageBytes")) {
            if (ConnectionRuntime.session?.state()?.let { it != "disconnected" } == true) return@synchronized failure("INVALID_INPUT")
            ConnectionRuntime.stop()
            writer.updateOptions(recovery, image)
            snapshot = writer.open()
          }
          ConnectionRuntime.prepared = true
          ConnectionRuntime.openConnection(context, snapshot)?.let { return@synchronized failure(it) }
          val session = ConnectionRuntime.session ?: return@synchronized failure("NATIVE_CALL_FAILED")
          val state = mutableMapOf<String, Any?>("state" to session.state())
          session.currentQR().takeIf { it.isNotEmpty() }?.let { qr ->
            val value = JSONObject(qr)
            state["qr"] = mapOf("value" to value.getString("value"), "expiresAt" to value.getLong("expiresAt"))
          }
          success(state)
        } catch (error: Exception) { ConnectionRuntime.stop(); failure(publicError(error)) }
      }
    }

    AsyncFunction("connect") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) return@synchronized failure("NOT_INITIALIZED")
        try {
          val context = appContext.reactContext ?: return@synchronized failure("MODULE_UNAVAILABLE")
          val writer = ConnectionRuntime.writer ?: return@synchronized failure("NOT_INITIALIZED")
          ConnectionRuntime.openConnection(context, writer.open())?.let { return@synchronized failure(it) }
          val code = ConnectionRuntime.session?.connect() ?: "NOT_INITIALIZED"
          if (code.isEmpty()) success() else failure(code)
        } catch (error: Exception) { ConnectionRuntime.stop(); failure(publicError(error)) }
      }
    }

    AsyncFunction("disconnect") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) failure("NOT_INITIALIZED") else {
          try { ConnectionRuntime.stop(); success() } catch (error: Exception) { failure(publicError(error)) }
        }
      }
    }

    AsyncFunction("logout") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) failure("NOT_INITIALIZED") else {
          try {
            val writer = ConnectionRuntime.writer ?: return@synchronized failure("NOT_INITIALIZED")
            ConnectionRuntime.stop()
            val hadSession = writer.open().optJSONObject("session") != null
            writer.endSession()
            if (hadSession) failure("REMOTE_LOGOUT_UNCONFIRMED") else success()
          } catch (error: Exception) { failure(publicError(error)) }
        }
      }
    }

    AsyncFunction("confirmMessageStored") { _: String -> failure("NATIVE_CALL_FAILED") }
    AsyncFunction("downloadImage") { _: Map<String, Any?> -> failure("NATIVE_CALL_FAILED") }
    AsyncFunction("deleteDownloadedImage") { _: String -> failure("NATIVE_CALL_FAILED") }

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
