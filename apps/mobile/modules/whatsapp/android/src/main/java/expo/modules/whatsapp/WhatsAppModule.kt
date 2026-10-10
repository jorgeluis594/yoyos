package expo.modules.whatsapp

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.whatsapp.go.bridge.Bridge
import expo.modules.whatsapp.go.bridge.Storage
import expo.modules.whatsapp.go.bridge.ProtocolStorage
import expo.modules.whatsapp.go.bridge.ProtocolSession
import expo.modules.whatsapp.go.bridge.ConnectionEvents
import expo.modules.whatsapp.go.bridge.ConnectionSession
import expo.modules.whatsapp.go.bridge.DeliveryEvents
import expo.modules.whatsapp.go.bridge.DeliverySession
import expo.modules.whatsapp.go.bridge.DeliveryStorage
import org.json.JSONArray
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
  private var revoked = false
  override fun onConnectionEvent(value: String) {
    synchronized(this) {
      if (!active) return
      try {
        val envelope = JSONObject(value)
        if (envelope.getInt("contractVersion") != 1) return
        val event = envelope.getString("event")
        if (event !in setOf("qr", "connectionChanged", "error")) return
        val payload = envelope.getJSONObject("payload")
        if (event == "connectionChanged" && payload.optString("state") == "sessionExpired") revoked = true
        forward(event, payload.keys().asSequence().associateWith { payload.get(it) })
      } catch (_: Exception) { /* Invalid native events never reach JavaScript. */ }
    }
  }
  fun retire(): Boolean = synchronized(this) { active = false; revoked }
}

private fun jsonValue(value: Any?): Any? = when (value) {
  is JSONObject -> value.keys().asSequence().filter { !value.isNull(it) }.associateWith { jsonValue(value.get(it)) }
  is JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }
  JSONObject.NULL -> null
  else -> value
}

/**
 * Receives Go deliveries on the coordinator's thread. Throwing tells Go the callback failed, which keeps
 * the pending entry and stops reception; a destroyed JavaScript runtime is such a failure.
 */
private class PublicDeliveryEvents(private val forward: () -> ((String, Map<String, Any?>) -> Unit)?) : DeliveryEvents {
  override fun onDelivery(value: String) {
    val emit = forward() ?: throw IllegalStateException("JavaScript runtime unavailable")
    val envelope = JSONObject(value)
    if (envelope.getInt("contractVersion") != 1 || envelope.getString("event") != "messageReceived") throw IllegalArgumentException("invalid delivery")
    val payload = envelope.getJSONObject("payload")
    emit("messageReceived", mapOf(
      "deliveryId" to payload.getString("deliveryId"),
      "message" to jsonValue(payload.getJSONObject("message")),
      "consumer" to envelope.getString("consumer"),
    ))
  }
}

private object ConnectionRuntime {
  val lock = Any()
  var writer: NativeStateStore? = null
  var session: ConnectionSession? = null
  var eventSink: PublicConnectionEvents? = null
  var prepared = false
  var revoked = false
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null
  var delivery: DeliverySession? = null
  var deliveryBudget = 0L
  var consumerToken: String? = null

  /** Recovery and confirmation need only the container, so this is open even when the session is invalid. */
  fun ensureDelivery(store: NativeStateStore, recoveryBytes: Long): String? {
    if (delivery != null && deliveryBudget == recoveryBytes) return null
    delivery?.close()
    delivery = null
    val result = Bridge.openDelivery(object : DeliveryStorage {
      override fun readPending(request: String): String = store.readPending(request)
      override fun retirePending(request: String): String = store.retirePending(request)
    }, PublicDeliveryEvents { emit }, recoveryBytes)
    val opened = result?.session ?: return bridgeCode(result?.code ?: "")
    delivery = opened
    deliveryBudget = recoveryBytes
    consumerToken?.let { opened.setConsumer(it) }
    opened.start()
    return null
  }

  fun runtimeDestroyed() {
    emit = null
    consumerToken?.let { delivery?.removeConsumer(it) }
    consumerToken = null
  }

  /** forLogout opens the stored session without network even after disconnect or revocation. */
  fun openConnection(context: Context, snapshot: JSONObject, forLogout: Boolean = false): String? {
    if (revoked && !forLogout) return "SESSION_EXPIRED"
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
      val result = Bridge.openConnectionWithDelivery(object : ProtocolStorage {
        override fun readState(request: String): String = store.readProtocolState(request)
        override fun applyChanges(request: String): String = store.applyProtocolChanges(request)
        override fun beginFreshSession(request: String): String = store.beginFreshProtocolSession(request)
      }, sink, delivery, generation, account, recovery, recovery)
      if (result?.session == null) {
        sink.retire()
        store.retireGeneration()
        return bridgeCode(result?.code ?: "")
      }
      session = result.session
      eventSink = sink
      if (revoked) session?.markRevoked() // reopened only to log out: never connect to unlink it
      return null
    } catch (error: Exception) {
      store.retireGeneration()
      return publicError(error)
    }
  }

  fun stop() {
    if (eventSink?.retire() == true) revoked = true
    eventSink = null
    val hadSession = session != null
    if (session?.close() == true) revoked = true
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
  "INVALID_INPUT", "NOT_INITIALIZED", "SESSION_STATE_INVALID", "SESSION_STORAGE_FAILED", "SESSION_STORAGE_LIMIT_REACHED", "RECOVERY_BUFFER_FULL" -> code
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
            if (ConnectionRuntime.revoked) return@synchronized failure("INVALID_INPUT")
            if (ConnectionRuntime.session?.canUpdateOptions() == false) return@synchronized failure("INVALID_INPUT")
            ConnectionRuntime.stop()
            writer.updateOptions(recovery, image)
            snapshot = writer.open()
          }
          ConnectionRuntime.prepared = true
          ConnectionRuntime.ensureDelivery(writer, recovery)?.let { return@synchronized failure(it) }
          if (ConnectionRuntime.revoked) return@synchronized success(mapOf("state" to "sessionExpired"))
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
            // After disconnect or revocation there is no Go session: open the stored one (no network)
            // so its verifiable mappings are completed before the credentials go. Unreadable credentials
            // (SESSION_STATE_INVALID) cannot be resolved and still allow retirement; any other failure keeps them.
            if (ConnectionRuntime.session == null && writer.open().optJSONObject("session") != null) {
              val context = appContext.reactContext ?: return@synchronized failure("MODULE_UNAVAILABLE")
              val opened = ConnectionRuntime.openConnection(context, writer.open(), forLogout = true)
              if (opened != null && opened != "SESSION_STATE_INVALID") {
                if (ConnectionRuntime.revoked) ConnectionRuntime.emit?.invoke("connectionChanged", mapOf("state" to "sessionExpired"))
                return@synchronized failure(opened)
              }
            }
            // Go stops reception, completes verifiable mappings and asks WhatsApp to unlink (15 s).
            val remote = ConnectionRuntime.session?.logout() ?: "REMOTE_LOGOUT_UNCONFIRMED"
            ConnectionRuntime.stop()
            // Any other code means nothing was unlinked or retired; credentials stay.
            if (remote.isNotEmpty() && remote != "REMOTE_LOGOUT_UNCONFIRMED") {
              // stop() announced disconnected; a revoked session is still sessionExpired.
              if (ConnectionRuntime.revoked) ConnectionRuntime.emit?.invoke("connectionChanged", mapOf("state" to "sessionExpired"))
              return@synchronized failure(bridgeCode(remote))
            }
            val hadSession = writer.open().optJSONObject("session") != null
            writer.endSession()
            ConnectionRuntime.revoked = false
            if (hadSession && remote.isNotEmpty()) failure("REMOTE_LOGOUT_UNCONFIRMED") else success()
          } catch (error: Exception) { failure(publicError(error)) }
        }
      }
    }

    OnDestroy { synchronized(ConnectionRuntime.lock) { ConnectionRuntime.runtimeDestroyed() } }

    AsyncFunction("confirmMessageStored") { id: String ->
      // The durable write runs on this background thread and outside the runtime lock.
      val delivery = synchronized(ConnectionRuntime.lock) { ConnectionRuntime.delivery }
      if (delivery == null) failure("NOT_INITIALIZED") else {
        try {
          val code = delivery.confirm(id)
          if (code.isEmpty()) success() else failure(bridgeCode(code))
        } catch (_: Exception) { failure("NATIVE_CALL_FAILED") }
      }
    }
    AsyncFunction("setMessageConsumer") { token: String ->
      val delivery = synchronized(ConnectionRuntime.lock) {
        ConnectionRuntime.consumerToken = token
        ConnectionRuntime.delivery
      }
      if (delivery == null) failure("NOT_INITIALIZED") else {
        val code = delivery.setConsumer(token)
        if (code.isEmpty()) success() else failure(bridgeCode(code))
      }
    }
    AsyncFunction("removeMessageConsumer") { token: String ->
      val delivery = synchronized(ConnectionRuntime.lock) {
        if (ConnectionRuntime.consumerToken == token) ConnectionRuntime.consumerToken = null
        ConnectionRuntime.delivery
      }
      delivery?.removeConsumer(token)
      success()
    }
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
