package expo.modules.whatsapp

import expo.modules.kotlin.functions.Coroutine
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
import expo.modules.whatsapp.go.bridge.ImageOperation
import expo.modules.whatsapp.go.bridge.ImageSession
import android.net.Uri
import java.io.File
import org.json.JSONArray
import android.content.Context
import org.json.JSONObject
import android.content.Intent
import android.os.Build
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

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

internal class PublicConnectionEvents(private val forward: (String, Map<String, Any?>) -> Unit) : ConnectionEvents {
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

internal object ConnectionRuntime {
  val lock = Any()
  var writer: NativeStateStore? = null
  var session: ConnectionSession? = null
  var eventSink: PublicConnectionEvents? = null
  var prepared = false
  var revoked = false
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null
  var delivery: DeliverySession? = null
  var deliveryBudget = 0L
  var deliveryReadBound = 0L
  var consumerToken: String? = null
  var images: ImageSession? = null
  var imageBudget = 0L
  /** A limit change admitted to Go's image queue; `initialize` takes it under the same lock hold and awaits it after releasing the lock. */
  class PendingImageLimit(val operation: ImageOperation, val bytes: Long)
  var pendingImageLimit: PendingImageLimit? = null

  /**
   * The private image directory and its byte budget exist apart from any session, so complete
   * files stay reusable and deletable after disconnect or logout.
   */
  fun ensureImages(store: NativeStateStore, imageBytes: Long): String? {
    val current = images
    if (current != null) {
      if (imageBudget == imageBytes) return null
      // The change is ordered behind the cleanup of a cancelled download (Go's image queue) and must
      // not be awaited here: this runs under the runtime lock, which confirmations and disconnects share.
      // `imageBudget` is only updated once Go confirmed the change (initialize), so a failure retries.
      pendingImageLimit = PendingImageLimit(current.beginSetLimit(imageBytes), imageBytes)
      return null
    }
    val result = Bridge.openImages(store.imagesDirectory().path, imageBytes)
    val opened = result?.session ?: return bridgeCode(result?.code ?: "")
    images = opened
    imageBudget = imageBytes
    return null
  }

  /** Recovery and confirmation need only the container, so this is open even when the session is invalid. */
  fun ensureDelivery(store: NativeStateStore, recoveryBytes: Long): String? {
    val readBound = store.recoveryReadBound()
    if (delivery != null && deliveryBudget == recoveryBytes && deliveryReadBound == readBound) return null
    delivery?.close()
    delivery = null
    val result = Bridge.openDelivery(object : DeliveryStorage {
      override fun readPending(request: String): String = store.readPending(request)
      override fun retirePending(request: String): String = store.retirePending(request)
    }, PublicDeliveryEvents { emit }, readBound, recoveryBytes)
    val opened = result?.session ?: return bridgeCode(result?.code ?: "")
    delivery = opened
    deliveryBudget = recoveryBytes
    deliveryReadBound = readBound
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
    appContext = context.applicationContext
    val store = writer ?: NativeStateStore(context).also { writer = it }
    if (snapshot.optJSONObject("session") != null && !store.canRestoreSession()) { stopAndRetire(); return "SESSION_STATE_INVALID" }
    if (session != null) return null
    val account = snapshot.optJSONObject("session")?.getString("accountId") ?: ""
    val generation = UUID.randomUUID().toString()
    val limits = snapshot.getJSONObject("options")
    val recovery = limits.getLong("maxRecoveryBufferBytes")
    try {
      if (account.isEmpty()) store.registerFreshGeneration(generation) else store.registerGeneration(generation, account)
      lateinit var sink: PublicConnectionEvents
      sink = PublicConnectionEvents { event, fields ->
        emit?.invoke(event, fields)
        observeConnectionEvent(sink, event, fields)
      }
      val result = Bridge.openConnectionWithDelivery(object : ProtocolStorage {
        override fun readState(request: String): String = store.readProtocolState(request)
        override fun applyChanges(request: String): String = store.applyProtocolChanges(request)
        override fun beginFreshSession(request: String): String = store.beginFreshProtocolSession(request)
      }, sink, delivery, generation, account, store.recoveryReadBound(), recovery)
      if (result?.session == null) {
        sink.retire()
        store.retireGeneration()
        return bridgeCode(result?.code ?: "")
      }
      session = result.session
      images?.let { session?.attachImages(it) }
      eventSink = sink
      if (revoked) session?.markRevoked() // reopened only to log out: never connect to unlink it
      return null
    } catch (error: Exception) {
      store.retireGeneration()
      return publicError(error)
    }
  }

  // ---- Android receive service (WA-12) ------------------------------------------------------------

  @Volatile var appContext: Context? = null
  /** A withdrawal that could not be saved: it is retried before any new start and never reported as persisted. */
  var intentRetirementPending = false
  private val background = Executors.newSingleThreadExecutor { Thread(it, "whatsapp-service-work").also { thread -> thread.isDaemon = true } }

  /**
   * Starts the foreground service from the caller's (allowed) context. A synchronous refusal, such as
   * ForegroundServiceStartNotAllowedException, is returned before `connect()` accepts anything. It never
   * asks for permissions and never retries with another service type.
   */
  fun startService(context: Context): String? = try {
    val intent = Intent(context, WhatsAppService::class.java).setAction(ReceiveServicePolicy.ACTION_START)
    // Count the start and raise the flag under the same lock the service's onDestroy takes to decide whether
    // it may clear the flag, so the check and the clear cannot interleave with a newer start (WA-12 r2).
    synchronized(serviceFlagLock) { pendingStarts.incrementAndGet(); serviceActive = true }
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    null
  } catch (_: Exception) { synchronized(serviceFlagLock) { pendingStarts.decrementAndGet(); serviceActive = false }; "CONNECTION_FAILED" }

  /** Guards the pair (`pendingStarts`, `serviceActive`) against the check-then-set of an old instance's onDestroy. */
  val serviceFlagLock = Any()

  /**
   * START requests not yet seen by a service instance. An old instance's onDestroy must not clear
   * `serviceActive` while a newer start is on its way (disconnect, then connect, then the old destroy).
   */
  val pendingStarts = AtomicInteger(0)

  /** True from a successful start request until the service is destroyed (set by the service itself). */
  @Volatile var serviceActive = false

  /**
   * Asks the service to stop itself. Context.stopService right after startForegroundService could bring the
   * service down before startForeground and crash the app (see ReceiveServicePolicy.ACTION_STOP); the service
   * receives ACTION_STOP, promotes if it still has to, and then calls stopSelfResult(startId).
   */
  fun stopService(context: Context) {
    if (!serviceActive) return
    try {
      val intent = Intent(context, WhatsAppService::class.java).setAction(ReceiveServicePolicy.ACTION_STOP)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    } catch (_: Exception) {
      // A running, already promoted service can still be stopped directly; a refused start never ran.
      try { context.stopService(Intent(context, WhatsAppService::class.java)) } catch (_: Exception) { /* nothing left to stop */ }
    }
  }

  /** Durably withdraws the intent. Callers hold the runtime lock, so a recreation can never see a stale `true`. */
  fun withdrawIntent(): String? {
    val store = writer ?: return if (intentRetirementPending) "SESSION_STORAGE_FAILED" else null
    return try {
      store.withdrawReceiveIntent()
      intentRetirementPending = false
      null
    } catch (error: Exception) {
      intentRetirementPending = true
      publicError(error)
    }
  }

  /** Withdraws the intent and stops the service; the Go session is left to the caller. */
  fun retireIntent(): String? {
    val code = withdrawIntent()
    appContext?.let { stopService(it) }
    return code
  }

  /**
   * Execution stops even when saving the withdrawal fails; the returned storage code tells the caller
   * not to claim that the intent is persisted.
   */
  fun stopAndRetire(): String? {
    val code = retireIntent()
    stop()
    return code
  }

  /** Arms reception only for a usable stored session. A failed save stops everything. */
  fun armIntent(store: NativeStateStore, snapshot: JSONObject): String? {
    val account = snapshot.optJSONObject("session")?.getString("accountId")
    if (!ReceiveServicePolicy.mayArmIntent(account, store.canRestoreSession(), revoked)) return null
    return try { store.armReceiveIntent(account!!); null } catch (error: Exception) { publicError(error) }
  }

  /** The service was refused after `connect()` accepted: error, disconnected, intent withdrawn, data kept. */
  fun serviceRefused() {
    // The service is stopping itself (stopSelf): a STOP request now would start a fresh instance and loop.
    serviceActive = false
    synchronized(lock) {
      val hadSession = session != null // stop() announces `disconnected` itself in that case
      val code = stopAndRetire()
      emit?.invoke("error", mapOf("code" to (code ?: "CONNECTION_FAILED"), "message" to "WhatsApp connection failed"))
      if (!hadSession) emit?.invoke("connectionChanged", mapOf("state" to "disconnected"))
    }
  }

  /** Called on Go's thread: nothing here may take the runtime lock inline. */
  private fun observeConnectionEvent(sink: PublicConnectionEvents, event: String, fields: Map<String, Any?>) {
    val revokedNow = event == "connectionChanged" && fields["state"] == "sessionExpired"
    val fault = event == "error" && ReceiveServicePolicy.isLocalFault(fields["code"] as? String ?: "")
    // Our own stops retire the sink first, so a `disconnected` seen here comes from Go. It may be a capacity
    // pause or a retry that Go resumes by itself (request still held): that keeps the service and the intent.
    val effect = ReceiveServicePolicy.eventEffect(event, fields["state"] as? String, fields["code"] as? String)
    if (!revokedNow && !fault && effect == ReceiveServicePolicy.EventEffect.NONE) return
    background.execute {
      synchronized(lock) {
        if (eventSink !== sink) return@synchronized
        // Settled under the lock, after Go set `requested` (it does so before publishing the state).
        val finished = revokedNow || fault || ReceiveServicePolicy.endsRequest(session?.requestActive() ?: false)
        if (!finished) return@synchronized
        if (revokedNow) revoked = true
        // A revoked session, a local fault or an ended request is not retried by START_STICKY; credentials stay.
        retireIntent()
      }
    }
  }

  /**
   * Runs on the service worker after promotion, with no JavaScript. Returns true only while one valid
   * generation runs. The decision, the intent read and the start share one lock hold, so a concurrent
   * `disconnect()`/`logout()` either withdraws first (this stops) or stops what this started.
   */
  fun restoreFromService(context: Context): Boolean = synchronized(lock) {
    try {
      appContext = context.applicationContext
      val store = writer ?: NativeStateStore(context).also { writer = it }
      if (intentRetirementPending && withdrawIntent() != null) return false
      val snapshot = store.open()
      val account = snapshot.optJSONObject("session")?.getString("accountId")
      val decision = ReceiveServicePolicy.decideRestore(store.receiveIntent(), account, store.canRestoreSession(), revoked)
      if (decision is RestoreDecision.Stop) {
        if (decision.retireIntent) withdrawIntent()
        return false
      }
      val options = snapshot.getJSONObject("options")
      // An already open session (initialize() got there first) is adopted, never duplicated, but it was
      // opened without a connection request: connect() below is idempotent (Controller.Connect keeps one
      // request), so recreation always ends with reception running or with the service stopped.
      if (ensureDelivery(store, options.getLong("maxRecoveryBufferBytes")) != null ||
        ensureImages(store, options.getLong("maxImageStorageBytes")) != null ||
        openConnection(context, snapshot) != null) { stopAndRetire(); return false }
      // No consumer is attached here: pending messages stay paused until JavaScript sets one.
      val code = session?.connect() ?: "NOT_INITIALIZED"
      if (code.isNotEmpty()) { stopAndRetire(); return false }
      true
    } catch (_: Exception) { stopAndRetire(); false }
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
private fun imageCode(code: String): String = when (code) {
  "INVALID_INPUT", "NOT_INITIALIZED", "IMAGE_UNAVAILABLE", "ACCOUNT_NOT_CONNECTED", "STORAGE_LIMIT_REACHED",
  "IMAGE_DOWNLOAD_FAILED", "IMAGE_DELETE_FAILED" -> code
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
      var limit: ConnectionRuntime.PendingImageLimit? = null
      var mutated = false
      val initialized = synchronized(ConnectionRuntime.lock) {
        ConnectionRuntime.pendingImageLimit = null
        // Taken under the same lock hold as the work that created it, so an interleaved initialize
        // can neither overwrite it nor await another call's operation.
        val result = run {
        try {
          val context = appContext.reactContext ?: return@run failure("MODULE_UNAVAILABLE")
          val writer = ConnectionRuntime.writer ?: NativeStateStore(context).also { ConnectionRuntime.writer = it }
          var snapshot = writer.open()
          if (options.keys.any { it !in setOf("maxRecoveryBufferBytes", "maxImageStorageBytes") }) return@run failure("INVALID_INPUT")
          val saved = snapshot.getJSONObject("options")
          val requested = mapOf(
            "maxRecoveryBufferBytes" to (options["maxRecoveryBufferBytes"] ?: 10L * 1024 * 1024),
            "maxImageStorageBytes" to (options["maxImageStorageBytes"] ?: 50L * 1024 * 1024),
          )
          for ((key, raw) in requested) {
            val value = raw as? Number ?: return@run failure("INVALID_INPUT")
            val integer = value.toLong()
            if (integer <= 0 || integer > 9007199254740991L || integer.toDouble() != value.toDouble()) return@run failure("INVALID_INPUT")
          }
          val recovery = (requested["maxRecoveryBufferBytes"] as Number).toLong()
          val image = (requested["maxImageStorageBytes"] as Number).toLong()
          if (recovery != saved.getLong("maxRecoveryBufferBytes") || image != saved.getLong("maxImageStorageBytes")) {
            if (ConnectionRuntime.revoked) return@run failure("INVALID_INPUT")
            if (ConnectionRuntime.session?.canUpdateOptions() == false) return@run failure("INVALID_INPUT")
            mutated = true // from here a failure may already have published: never report it as a refusal
            ConnectionRuntime.stopAndRetire()?.let { return@run failure(it) }
            writer.updateOptions(recovery, image)
            snapshot = writer.open()
          }
          ConnectionRuntime.prepared = true
          ConnectionRuntime.ensureDelivery(writer, recovery)?.let { return@run failure(it) }
          ConnectionRuntime.ensureImages(writer, image)?.let { return@run failure(it) }
          if (ConnectionRuntime.revoked) return@run success(mapOf("state" to "sessionExpired"))
          ConnectionRuntime.openConnection(context, snapshot)?.let { return@run failure(it) }
          val session = ConnectionRuntime.session ?: return@run failure("NATIVE_CALL_FAILED")
          val state = mutableMapOf<String, Any?>("state" to session.state())
          session.currentQR().takeIf { it.isNotEmpty() }?.let { qr ->
            val value = JSONObject(qr)
            state["qr"] = mapOf("value" to value.getString("value"), "expiresAt" to value.getLong("expiresAt"))
          }
          success(state)
        } catch (error: Exception) { ConnectionRuntime.stopAndRetire(); failure(publicError(error)) }
        }
        limit = ConnectionRuntime.pendingImageLimit
        ConnectionRuntime.pendingImageLimit = null
        result
      }
      // Success is reported only after a reduced or raised image limit took effect, i.e. after the
      // cancelled download's cleanup; the writer and the runtime lock are free while this waits.
      val code = try { limit?.operation?.outcome()?.code ?: "" } catch (_: Exception) { "NATIVE_CALL_FAILED" }
      if (initialized["success"] == true && limit != null && code.isEmpty()) {
        synchronized(ConnectionRuntime.lock) { ConnectionRuntime.imageBudget = limit.bytes }
      }
      when {
        initialized["success"] == true && code.isNotEmpty() -> failure(imageCode(code))
        // INVALID_INPUT means "refused before anything changed"; after the options were published or
        // the session stopped it would make the client keep believing in the old options.
        mutated && ((initialized["error"] as? Map<*, *>)?.get("code") == "INVALID_INPUT") -> failure("NATIVE_CALL_FAILED")
        else -> initialized
      }
    }

    AsyncFunction("connect") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) return@synchronized failure("NOT_INITIALIZED")
        try {
          val context = appContext.reactContext ?: return@synchronized failure("MODULE_UNAVAILABLE")
          val writer = ConnectionRuntime.writer ?: return@synchronized failure("NOT_INITIALIZED")
          if (ConnectionRuntime.revoked) return@synchronized failure("SESSION_EXPIRED")
          // Promotion comes first: the service publishes its notification before Go or storage load.
          // A refusal here is a failed Result and leaves no intent, no data change and no retry.
          ConnectionRuntime.startService(context)?.let { return@synchronized failure(it) }
          if (ConnectionRuntime.intentRetirementPending) ConnectionRuntime.withdrawIntent()?.let { ConnectionRuntime.stopService(context); return@synchronized failure(it) }
          val snapshot = writer.open()
          ConnectionRuntime.openConnection(context, snapshot)?.let { ConnectionRuntime.retireIntent(); return@synchronized failure(it) }
          ConnectionRuntime.armIntent(writer, snapshot)?.let { code -> ConnectionRuntime.stopAndRetire(); return@synchronized failure(code) }
          val code = ConnectionRuntime.session?.connect() ?: "NOT_INITIALIZED"
          if (code.isEmpty()) success() else { ConnectionRuntime.retireIntent(); failure(code) }
        } catch (error: Exception) { ConnectionRuntime.stopAndRetire(); failure(publicError(error)) }
      }
    }

    AsyncFunction("disconnect") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) failure("NOT_INITIALIZED") else {
          // The durable withdrawal comes before success; if saving fails, execution still stops and the
          // storage error is returned instead of claiming the intent was persisted.
          try { ConnectionRuntime.stopAndRetire()?.let { failure(it) } ?: success() } catch (error: Exception) { failure(publicError(error)) }
        }
      }
    }

    AsyncFunction("logout") {
      synchronized(ConnectionRuntime.lock) {
        if (!ConnectionRuntime.prepared) failure("NOT_INITIALIZED") else {
          try {
            val writer = ConnectionRuntime.writer ?: return@synchronized failure("NOT_INITIALIZED")
            // The intent is withdrawn before any unlink attempt; credentials stay when saving it fails.
            ConnectionRuntime.retireIntent()?.let { code -> ConnectionRuntime.stop(); return@synchronized failure(code) }
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
    // Image calls can block for a whole download (60 s) and may wait in Go's own queue. Expo's default
    // AsyncFunction queue is one thread shared by every function and module, so the long wait runs
    // elsewhere (ImageOperations): confirmMessageStored, disconnect and logout never wait behind a
    // download, and a disconnect cancels the transfer immediately. Admission order, which Go fixes in
    // beginDownload/beginDelete, follows call order because one dedicated thread admits. Go returns
    // the published file path, never its bytes.
    AsyncFunction("downloadImage") Coroutine { reference: Map<String, Any?> ->
      val images = synchronized(ConnectionRuntime.lock) { ConnectionRuntime.images }
      val messageId = reference["messageId"] as? String
      val downloadReference = reference["downloadReference"] as? String
      when {
        images == null -> failure("NOT_INITIALIZED")
        messageId == null || downloadReference == null -> failure("INVALID_INPUT")
        else -> ImageOperations.run({ images.beginDownload(messageId, downloadReference) }) { operation ->
          try {
            val result = operation.outcome()
            when {
              result == null -> failure("NATIVE_CALL_FAILED")
              result.code.isNotEmpty() -> failure(imageCode(result.code))
              else -> success(mapOf("uri" to Uri.fromFile(File(result.path)).toString(), "mimeType" to result.mimeType, "size" to result.size))
            }
          } catch (_: Exception) { failure("NATIVE_CALL_FAILED") }
        }
      }
    }
    AsyncFunction("deleteDownloadedImage") Coroutine { messageId: String ->
      val images = synchronized(ConnectionRuntime.lock) { ConnectionRuntime.images }
      if (images == null) failure("NOT_INITIALIZED") else ImageOperations.run({ images.beginDelete(messageId) }) { operation ->
        try {
          val code = operation.outcome().code
          if (code.isEmpty()) success() else failure(imageCode(code))
        } catch (_: Exception) { failure("NATIVE_CALL_FAILED") }
      }
    }

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
