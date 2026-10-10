package expo.modules.whatsapp

import android.content.Context
import android.os.Build
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Base64
import expo.modules.whatsapp.go.bridge.Bridge
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.locks.ReentrantLock
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class StateFailure(val code: String) : Exception(code)

/** Native-only snapshot writer. Callers hold no mutable copy of the published state. */
internal class NativeStateStore(private val context: Context, keySpaceSuffix: String = "", private val fault: ((String) -> Unit)? = null) {
  private val keySpace = if (keySpaceSuffix.isEmpty()) "yoyos.whatsapp" else {
    require(Regex("[0-9a-f]{32}").matches(keySpaceSuffix))
    "yoyos.whatsapp.test.$keySpaceSuffix"
  }
  private val directory = File(context.noBackupFilesDir, "whatsapp")
  private val published = File(directory, "state.bin")
  private val temporary = File(directory, "state.next")
  private val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  // All mutable writer state is guarded by GLOBAL_LOCK. Do not add instance-monitor
  // synchronization: callers such as applyProtocolChanges take GLOBAL_LOCK first.
  private var current: JSONObject? = null
  private var storeId = ""
  private var recoveryId = ""
  private var revision = BigInteger.ZERO
  @Volatile private var readBudget = DEFAULT_BUFFER
  private var uncertain = false
  private var sessionUsable = true
  private var registeredGeneration: String? = null
  private var registeredAccount: String? = null
  private var observedPublication = -1L

  // The secure creation record is a Keystore-backed encrypted file. Its key is created before
  // the first state key; a partial record cannot be mistaken for an empty installation.
  private val recordFile get() = File(directory, "creation.bin")
  private val recordNext get() = File(directory, "creation.next")
  private val recordAlias = "$keySpace.creation-key"
  private val markerPrefix = "$keySpace.creation."
  private val readyPrefix = "$keySpace.ready."
  private fun marker(store: String, recovery: String) = "$markerPrefix$store.$recovery"
  private fun alias(id: String) = "$keySpace.key.$id"

  fun open(): JSONObject {
    GLOBAL_LOCK.lock()
    try {
      if (Build.VERSION.SDK_INT >= 24 && !context.getSystemService(UserManager::class.java).isUserUnlocked) throw StateFailure("STORAGE_FAILED")
      if (uncertain) { current = null; uncertain = false }
      if (observedPublication == publication) current?.let { return JSONObject(it.toString()) }
      current = null
      val hasDirectory = existsChecked(directory)
      if (!hasDirectory && !directory.mkdirs()) throw StateFailure("STORAGE_FAILED")
      val record = readRecord()
      if (record == null) {
        val aliases = mutableListOf<String>()
        val names = keys.aliases()
        while (names.hasMoreElements()) aliases.add(names.nextElement())
        if (aliases.any { it.startsWith(readyPrefix) } || existsChecked(published)) throw StateFailure("SESSION_STATE_INVALID")
        val markers = aliases.filter { it.startsWith(markerPrefix) }
        if (markers.size > 1) throw StateFailure("SESSION_STATE_INVALID")
        removeTemp(recordNext)
        if (markers.size == 1) {
          val parts = markers.single().removePrefix(markerPrefix).split('.')
          if (parts.size != 2 || !ID.matches(parts[0]) || !ID.matches(parts[1])) throw StateFailure("SESSION_STATE_INVALID")
          removeTemp(temporary)
          storeId = parts[0]; recoveryId = parts[1]; readBudget = DEFAULT_BUFFER
          val pending = JSONObject().put("status", "creating").put("storeId", storeId)
            .put("recoveryKeyId", recoveryId).put("readBudget", readBudget).put("preparedRevision", "0")
            .put("provisionalSessionKeyId", JSONObject.NULL)
          ensureKey(recordAlias)
          writeRecord(pending)
          return open()
        }
        if (existsChecked(temporary)) throw StateFailure("SESSION_STATE_INVALID")
        if (hasDirectory) {
          val entries = directory.listFiles() ?: throw StateFailure("STORAGE_FAILED")
          if (entries.isNotEmpty()) throw StateFailure("SESSION_STATE_INVALID")
        }
        return create()
      }
      storeId = record.getString("storeId")
      recoveryId = record.getString("recoveryKeyId")
      readBudget = record.getLong("readBudget")
      if (!keys.containsAlias(marker(storeId, recoveryId))) throw StateFailure("SESSION_STATE_INVALID")
      val preparedRevision = parseRevision(record.getString("preparedRevision"))
      if (existsChecked(published)) {
        val state = readSnapshot(published, readBudget)
        if (revision > preparedRevision) throw StateFailure("SESSION_STATE_INVALID")
        if (record.getString("status") == "creating") {
          ensureNamedKey(readyPrefix + storeId)
          writeRecord(record.put("status", "ready"))
        } else if (!keys.containsAlias(readyPrefix + storeId)) throw StateFailure("SESSION_STATE_INVALID")
        removeTemp(temporary)
        removeTemp(recordNext)
        ensureImagesDirectory()
        current = state
        observedPublication = publication
        try {
          cleanupProvisional(record, state)
          if (state.getJSONArray("sessionKeysToDelete").length() > 0) {
            endSession()
            return open()
          }
        } catch (e: Exception) {
          current = null
          throw e
        }
        return JSONObject((current ?: state).toString())
      }
      if (record.getString("status") != "creating") throw StateFailure("SESSION_STATE_INVALID")
      removeTemp(temporary)
      ensureKey(recoveryId)
      val state = emptyState()
      publish(state, BigInteger.ZERO)
      fault?.invoke("initialPublication")
      ensureNamedKey(readyPrefix + storeId)
      writeRecord(record.put("status", "ready"))
      ensureImagesDirectory()
      current = state
      observedPublication = publication
      return JSONObject(state.toString())
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun commit(expectedRevision: String, change: (JSONObject) -> JSONObject): JSONObject {
    GLOBAL_LOCK.lock()
    try {
      val old = open()
      val originalSession = old.opt("session")?.toString()
      if (parseRevision(expectedRevision) != revision) throw StateFailure("SESSION_REVISION_MISMATCH")
      if (revision == MAX_REVISION) throw StateFailure("STATE_INVALID")
      val next = change(old)
      val requested = next.getJSONObject("options").getLong("maxRecoveryBufferBytes")
      val record = readRecord() ?: throw StateFailure("SESSION_STATE_INVALID")
      val nextBound = maxOf(readBudget, requested)
      validateState(next, revision + BigInteger.ONE, nextBound, !sessionUsable && next.opt("session")?.toString() == originalSession)
      writeRecord(record.put("readBudget", nextBound).put("preparedRevision", (revision + BigInteger.ONE).toString()))
      readBudget = nextBound
      publish(next, revision + BigInteger.ONE)
      current = JSONObject(next.toString())
      observedPublication = publication
      return JSONObject(next.toString())
    } catch (e: Exception) {
      current = null
      throw e
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun beginSession(accountId: String, protocolBytes: ByteArray) {
    GLOBAL_LOCK.lock()
    try {
      registeredGeneration = null
      registeredAccount = null
      current = null
      val state = open()
      if (protocolBytes.size > SESSION_LIMIT) throw StateFailure("SESSION_STORAGE_LIMIT_REACHED")
      if (state.opt("session") != JSONObject.NULL || state.getJSONArray("sessionKeysToDelete").length() != 0) throw StateFailure("SESSION_STATE_INVALID")
      if (!ACCOUNT.matches(accountId)) throw StateFailure("INVALID_INPUT")
      if (revision == MAX_REVISION) throw StateFailure("STATE_INVALID")
      val protocol = parseObject(protocolBytes)
      exact(protocol, "protocolSchemaVersion", "records")
      if (protocol.get("protocolSchemaVersion") !is Number || protocol.get("protocolSchemaVersion").toString() != "1" || protocol.get("records") !is JSONArray) throw StateFailure("SESSION_STATE_INVALID")
      val record = readRecord() ?: throw StateFailure("SESSION_STATE_INVALID")
      val id = newId()
      writeRecord(record.put("provisionalSessionKeyId", id))
      fault?.invoke("provisionalRecord")
      ensureKey(id)
      fault?.invoke("sessionKey")
      val nextRevision = revision + BigInteger.ONE
      val aad = sessionAad(storeId, accountId, id, nextRevision.toString())
      val (nonce, ciphertext) = encrypt(id, protocolBytes, aad)
      val session = JSONObject().put("accountId", accountId).put("sessionKeyId", id).put("sessionRevision", nextRevision.toString())
        .put("nonceBase64", b64(nonce)).put("ciphertextBase64", b64(ciphertext))
      commit(revision.toString()) { it.put("session", session) }
      fault?.invoke("sessionPublished")
      val committedRecord = readRecord() ?: throw StateFailure("SESSION_STATE_INVALID")
      writeRecord(committedRecord.put("provisionalSessionKeyId", JSONObject.NULL))
    } finally { current = null; GLOBAL_LOCK.unlock() }
  }

  fun canRestoreSession(): Boolean {
    GLOBAL_LOCK.lock()
    try {
      open()
      return sessionUsable
    } finally { GLOBAL_LOCK.unlock() }
  }

  /** Called by the native connection controller before opening the Go store. */
  fun registerGeneration(generationId: String, accountId: String) {
    GLOBAL_LOCK.lock()
    try {
      val snapshot = open()
      if (generationId.isEmpty() || !ACCOUNT.matches(accountId) ||
        snapshot.optJSONObject("session")?.getString("accountId") != accountId) throw StateFailure("STALE_GENERATION")
      registeredGeneration = generationId
      registeredAccount = accountId
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun registerFreshGeneration(generationId: String) {
    GLOBAL_LOCK.lock()
    try {
      val snapshot = open()
      if (generationId.isEmpty() || snapshot.optJSONObject("session") != null) throw StateFailure("STALE_GENERATION")
      registeredGeneration = generationId
      registeredAccount = null
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun retireGeneration() {
    GLOBAL_LOCK.lock()
    try { registeredGeneration = null; registeredAccount = null } finally { GLOBAL_LOCK.unlock() }
  }

  fun updateOptions(maxRecoveryBufferBytes: Long, maxImageStorageBytes: Long): String {
    GLOBAL_LOCK.lock()
    try {
      if (maxRecoveryBufferBytes !in 1L..9007199254740991L || maxImageStorageBytes !in 1L..9007199254740991L) throw StateFailure("INVALID_REQUEST")
      val snapshot = open()
      val old = snapshot.getJSONObject("options")
      if (old.getLong("maxRecoveryBufferBytes") == maxRecoveryBufferBytes && old.getLong("maxImageStorageBytes") == maxImageStorageBytes) return revision.toString()
      commit(revision.toString()) { state ->
        state.put("options", JSONObject().put("maxRecoveryBufferBytes", maxRecoveryBufferBytes).put("maxImageStorageBytes", maxImageStorageBytes))
      }
      return revision.toString()
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun beginFreshProtocolSession(request: String): String = protocolResponse {
    if (request.toByteArray(Charsets.UTF_8).size > SESSION_LIMIT + 1024) throw StateFailure("INVALID_REQUEST")
    val input = parseProtocolRequest(request)
    exact(input, "contractVersion", "generationId", "accountId", "device")
    if (input.get("contractVersion") !is Number || input.get("contractVersion").toString() != "1") throw StateFailure("INVALID_REQUEST")
    val generation = input.getString("generationId")
    val account = input.getString("accountId")
    if (generation.isEmpty() || !ACCOUNT.matches(account)) throw StateFailure("INVALID_REQUEST")
    val device = input.getJSONObject("device")
    exact(device, "recordType", "recordKey", "valueBase64")
    if (device.getString("recordType") != "device") throw StateFailure("INVALID_REQUEST")
    validateProtocolChange(JSONObject(device.toString()).put("operation", "put"))
    if (!Bridge.validateProtocolChange("put", device.getString("recordType"), device.getString("recordKey"), device.getString("valueBase64"))) throw StateFailure("INVALID_REQUEST")
    val value = parseObject(decode(device.getString("valueBase64"), SESSION_LIMIT))
    if (deviceAccount(value.getString("lid")) != account || value.getString("id").isEmpty()) throw StateFailure("INVALID_REQUEST")
    val protocol = JSONObject().put("protocolSchemaVersion", 1).put("records", JSONArray().put(device))
    validateProtocolRecords(protocol.getJSONArray("records"), account)
    GLOBAL_LOCK.lock()
    try {
      if (registeredGeneration != generation || (registeredAccount != null && registeredAccount != account)) throw StateFailure("STALE_GENERATION")
      val existing = open().optJSONObject("session")
      if (existing == null) {
        try { beginSession(account, protocol.toString().toByteArray(Charsets.UTF_8)) }
        finally { registeredGeneration = generation; registeredAccount = null }
      }
      else {
        if (!sessionUsable || existing.getString("accountId") != account ||
          decryptProtocol(existing).getJSONArray("records").toString() != protocol.getJSONArray("records").toString()) throw StateFailure("STALE_GENERATION")
      }
      registerGeneration(generation, account)
      val final = open().getJSONObject("session")
      JSONObject().put("revision", revision.toString()).put("sessionRevision", final.getString("sessionRevision"))
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun readProtocolState(request: String): String = protocolResponse {
    if (request.toByteArray(Charsets.UTF_8).size > 128) throw StateFailure("INVALID_REQUEST")
    val input = parseProtocolRequest(request)
    exact(input, "contractVersion")
    if (input.get("contractVersion") !is Number || input.get("contractVersion").toString() != "1") throw StateFailure("INVALID_REQUEST")
    GLOBAL_LOCK.lock()
    try {
      val snapshot = open()
      val session = snapshot.optJSONObject("session")
      val data = JSONObject().put("revision", revision.toString())
        .put("sessionRevision", session?.getString("sessionRevision") ?: "0")
        .put("pending", snapshot.getJSONArray("pending"))
      if (session == null) data.put("session", JSONObject.NULL) else {
        if (!sessionUsable) throw StateFailure("STATE_INVALID")
        val plain = decryptProtocol(session)
        validateProtocolRecords(plain.getJSONArray("records"), session.getString("accountId"))
        data.put("session", JSONObject().put("accountId", session.getString("accountId"))
          .put("protocolSchemaVersion", 1).put("records", plain.getJSONArray("records")))
      }
      data
    } finally { GLOBAL_LOCK.unlock() }
  }

  /** Pending entries need neither a generation nor a usable session: recovery works with any account. */
  fun readPending(request: String): String = protocolResponse {
    if (request.toByteArray(Charsets.UTF_8).size > 128) throw StateFailure("INVALID_REQUEST")
    val input = parseProtocolRequest(request)
    exact(input, "contractVersion")
    if (input.get("contractVersion") !is Number || input.get("contractVersion").toString() != "1") throw StateFailure("INVALID_REQUEST")
    GLOBAL_LOCK.lock()
    try {
      val snapshot = open()
      JSONObject().put("revision", revision.toString()).put("pending", snapshot.getJSONArray("pending"))
    } finally { GLOBAL_LOCK.unlock() }
  }

  /** Removes the whole entry durably; a valid identifier with no entry succeeds without publishing. */
  fun retirePending(request: String): String = protocolResponse {
    if (request.toByteArray(Charsets.UTF_8).size > 256) throw StateFailure("INVALID_REQUEST")
    val input = parseProtocolRequest(request)
    exact(input, "contractVersion", "deliveryId")
    if (input.get("contractVersion") !is Number || input.get("contractVersion").toString() != "1" ||
      input.get("deliveryId") !is String || !DELIVERY.matches(input.getString("deliveryId"))) throw StateFailure("INVALID_REQUEST")
    val id = input.getString("deliveryId")
    GLOBAL_LOCK.lock()
    try {
      val snapshot = open()
      val existing = snapshot.getJSONArray("pending")
      val kept = JSONArray()
      var removed = false
      for (i in 0 until existing.length()) {
        val item = existing.getJSONObject(i)
        if (item.getString("deliveryId") == id) removed = true else kept.put(item)
      }
      if (removed) commit(revision.toString()) { old -> old.put("pending", kept) }
      JSONObject().put("revision", revision.toString()).put("removed", removed)
    } finally { GLOBAL_LOCK.unlock() }
  }

  fun applyProtocolChanges(request: String): String = protocolResponse {
    if (request.toByteArray(Charsets.UTF_8).size > SESSION_LIMIT.toLong() + readBudget + 12340L) throw StateFailure("INVALID_REQUEST")
    val input = parseProtocolRequest(request)
    exact(input, "contractVersion", "generationId", "accountId", "expectedSessionRevision", "protocolChanges", "pendingInserts", "pendingIdentityUpdates")
    if (input.get("contractVersion") !is Number || input.get("contractVersion").toString() != "1" || input.get("generationId") !is String ||
      input.get("accountId") !is String || input.get("expectedSessionRevision") !is String) throw StateFailure("INVALID_REQUEST")
    val generation = input.getString("generationId")
    val account = input.getString("accountId")
    val expected = parseRevision(input.getString("expectedSessionRevision"))
    val changes = input.getJSONArray("protocolChanges")
    val inserts = input.getJSONArray("pendingInserts")
    val updates = input.getJSONArray("pendingIdentityUpdates")
    if (changes.length() == 0 && inserts.length() == 0 && updates.length() == 0) throw StateFailure("INVALID_REQUEST")
    for (i in 0 until changes.length()) {
      val change = changes.getJSONObject(i)
      validateProtocolChange(change)
      if (!Bridge.validateProtocolChange(change.getString("operation"), change.getString("recordType"), change.getString("recordKey"), change.optString("valueBase64"))) throw StateFailure("INVALID_REQUEST")
    }
    for (i in 0 until inserts.length()) {
      val item = inserts.getJSONObject(i)
      exact(item, "deliveryId", "accountId", "source", "identityState", "recovery", *(if (item.has("message")) arrayOf("message") else emptyArray()))
      if (item.getString("accountId") != account || !DELIVERY.matches(item.getString("deliveryId"))) throw StateFailure("INVALID_REQUEST")
    }
    for (i in 0 until updates.length()) {
      val item = updates.getJSONObject(i)
      exact(item, "deliveryId", "identityState", "message")
      if (!DELIVERY.matches(item.getString("deliveryId")) || item.getString("identityState") != "resolved") throw StateFailure("INVALID_REQUEST")
    }
    GLOBAL_LOCK.lock()
    try {
      if (request.toByteArray(Charsets.UTF_8).size > SESSION_LIMIT.toLong() + readBudget + 12340L) throw StateFailure("INVALID_REQUEST")
      if (registeredGeneration != generation || registeredAccount != account) throw StateFailure("STALE_GENERATION")
      val snapshot = open()
      val session = snapshot.optJSONObject("session") ?: throw StateFailure("STALE_GENERATION")
      if (session.getString("accountId") != account) throw StateFailure("STALE_GENERATION")
      if (parseRevision(session.getString("sessionRevision")) != expected) throw StateFailure("SESSION_REVISION_MISMATCH")
      val oldProtocol = decryptProtocol(session)
      val records = oldProtocol.getJSONArray("records")
      val ordered = linkedMapOf<String, JSONObject>()
      for (i in 0 until records.length()) {
        val record = records.getJSONObject(i)
        ordered[record.getString("recordType") + "\u0000" + record.getString("recordKey")] = record
      }
      for (i in 0 until changes.length()) {
        val change = changes.getJSONObject(i)
        val key = change.getString("recordType") + "\u0000" + change.getString("recordKey")
        if (change.getString("operation") == "delete") ordered.remove(key)
        else ordered[key] = JSONObject().put("recordType", change.getString("recordType"))
          .put("recordKey", change.getString("recordKey")).put("valueBase64", change.getString("valueBase64"))
      }
      val merged = JSONArray()
      ordered.values.forEach { merged.put(it) }
      validateProtocolRecords(merged, account)
      val oldDevice = (0 until records.length()).map { records.getJSONObject(it) }.firstOrNull { it.getString("recordType") == "device" }
      val newDevice = (0 until merged.length()).map { merged.getJSONObject(it) }.firstOrNull { it.getString("recordType") == "device" }
      if (oldDevice != null && (newDevice == null ||
        parseObject(decode(oldDevice.getString("valueBase64"), SESSION_LIMIT)).getString("id") !=
        parseObject(decode(newDevice.getString("valueBase64"), SESSION_LIMIT)).getString("id"))) throw StateFailure("INVALID_REQUEST")
      val protocol = JSONObject().put("protocolSchemaVersion", 1).put("records", merged)
      val plain = protocol.toString().toByteArray(Charsets.UTF_8)
      if (plain.size > SESSION_LIMIT) throw StateFailure("SESSION_STORAGE_LIMIT_REACHED")
      val existing = snapshot.getJSONArray("pending")
      val pending = JSONArray(existing.toString())
      val ids = (0 until pending.length()).map { pending.getJSONObject(it).getString("deliveryId") }.toMutableSet()
      for (i in 0 until inserts.length()) {
        val item = JSONObject(inserts.getJSONObject(i).toString())
        if (!ids.add(item.getString("deliveryId"))) throw StateFailure("INVALID_REQUEST")
        item.put("createdRevision", (revision + BigInteger.ONE).toString()).put("createdOrdinal", i)
        pending.put(item)
      }
      for (i in 0 until updates.length()) {
        val update = updates.getJSONObject(i)
        val id = update.getString("deliveryId")
        var found = false
        for (j in 0 until existing.length()) {
          val item = pending.getJSONObject(j)
          if (item.getString("deliveryId") == id && item.getString("identityState") == "pendingLid") {
            item.put("identityState", "resolved").put("message", update.getJSONObject("message"))
            found = true
          }
        }
        if (!found) throw StateFailure("INVALID_REQUEST")
      }
      val maxPending = snapshot.getJSONObject("options").getLong("maxRecoveryBufferBytes")
      if (pending.toString().toByteArray(Charsets.UTF_8).size > maxPending) throw StateFailure("BUFFER_FULL")
      val nextRevision = revision + BigInteger.ONE
      val nextSession = if (changes.length() == 0) session else {
        val id = session.getString("sessionKeyId")
        val (nonce, ciphertext) = encrypt(id, plain, sessionAad(storeId, account, id, nextRevision.toString()))
        JSONObject().put("accountId", account).put("sessionKeyId", id).put("sessionRevision", nextRevision.toString())
          .put("nonceBase64", b64(nonce)).put("ciphertextBase64", b64(ciphertext))
      }
      val next = commit(revision.toString()) { old -> old.put("session", nextSession).put("pending", pending) }
      JSONObject().put("revision", revision.toString())
        .put("sessionRevision", next.getJSONObject("session").getString("sessionRevision"))
    } finally { GLOBAL_LOCK.unlock() }
  }

  private fun decryptProtocol(session: JSONObject): JSONObject {
    val id = session.getString("sessionKeyId")
    val nonce = decode(session.getString("nonceBase64"), 12)
    val ciphertext = decode(session.getString("ciphertextBase64"), SESSION_LIMIT)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getKey(id), GCMParameterSpec(128, nonce))
    cipher.updateAAD(sessionAad(storeId, session.getString("accountId"), id, session.getString("sessionRevision")))
    return parseObject(cipher.doFinal(ciphertext))
  }

  private fun parseProtocolRequest(request: String): JSONObject = try {
    parseObject(request.toByteArray(Charsets.UTF_8))
  } catch (_: Exception) { throw StateFailure("INVALID_REQUEST") }

  private fun protocolResponse(action: () -> JSONObject): String = try {
    JSONObject().put("contractVersion", 1).put("success", true).put("data", action()).toString()
  } catch (e: StateFailure) {
    JSONObject().put("contractVersion", 1).put("success", false)
      .put("error", JSONObject().put("code", when (e.code) {
        "SESSION_STORAGE_LIMIT_REACHED" -> "SESSION_FULL"
        "SESSION_STATE_INVALID" -> "STATE_INVALID"
        "SESSION_REVISION_MISMATCH" -> "SESSION_REVISION_MISMATCH"
        "BUFFER_FULL" -> "BUFFER_FULL"
        "STALE_GENERATION" -> "STALE_GENERATION"
        "INVALID_REQUEST" -> "INVALID_REQUEST"
        else -> "STORAGE_FAILED"
      }).put("message", e.code)).toString()
  } catch (_: Exception) {
    JSONObject().put("contractVersion", 1).put("success", false)
      .put("error", JSONObject().put("code", "STORAGE_FAILED").put("message", "native writer failed")).toString()
  }

  private fun validateProtocolChange(change: JSONObject) {
    val put = change.optString("operation") == "put"
    if (!put && change.optString("operation") != "delete") throw StateFailure("INVALID_REQUEST")
    exact(change, "operation", "recordType", "recordKey", *(if (put) arrayOf("valueBase64") else emptyArray()))
    val kind = change.getString("recordType")
    if (kind == "device" && !put) throw StateFailure("INVALID_REQUEST")
    val arity = when (kind) {
      "device", "prekey-state", "nct-salt" -> 0
      "identity", "signal-session", "prekey", "app-state-key", "app-state-version", "contact", "chat-setting", "privacy-token", "lid-mapping", "retry-hash" -> 1
      "sender-key", "app-state-mac" -> 2
      "message-secret" -> 3
      else -> throw StateFailure("INVALID_REQUEST")
    }
    val key = change.getString("recordKey")
    if (key.length > 2048 || !Regex("[A-Za-z0-9_-]+").matches(key)) throw StateFailure("INVALID_REQUEST")
    val bytes = Base64.decode(key, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    if (Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) != key) throw StateFailure("INVALID_REQUEST")
    StrictJson.check(bytes.toString(Charsets.UTF_8))
    val tuple = JSONArray(bytes.toString(Charsets.UTF_8))
    if (tuple.length() != arity || (0 until arity).any { tuple.get(it) !is String || tuple.getString(it).isEmpty() || tuple.getString(it).length > 512 } || tuple.toString() != bytes.toString(Charsets.UTF_8)) throw StateFailure("INVALID_REQUEST")
    val parts = (0 until arity).map { tuple.getString(it) }
    fun decimal(text: String, max: Long, allowZero: Boolean): Boolean =
      Regex(if (allowZero) "0|[1-9][0-9]*" else "[1-9][0-9]*").matches(text) && (text.toLongOrNull()?.let { it <= max } == true)
    fun binary(text: String, min: Int, max: Int): Boolean = try { decode(text, max).size in min..max } catch (_: Exception) { false }
    when (kind) {
      "prekey" -> if (!decimal(parts[0], 4294967295L, false)) throw StateFailure("INVALID_REQUEST")
      "identity", "signal-session" -> if (!validSignalAddress(parts[0])) throw StateFailure("INVALID_REQUEST")
      "sender-key" -> if (!validSignalAddress(parts[1])) throw StateFailure("INVALID_REQUEST")
      "app-state-key" -> if (!binary(parts[0], 1, 256)) throw StateFailure("INVALID_REQUEST")
      "app-state-mac" -> if (!binary(parts[1], 32, 32)) throw StateFailure("INVALID_REQUEST")
      "retry-hash" -> if (!binary(parts[0], 32, 32)) throw StateFailure("INVALID_REQUEST")
      "lid-mapping" -> if (!Regex("[0-9]+@s\\.whatsapp\\.net").matches(parts[0])) throw StateFailure("INVALID_REQUEST")
    }
    if (put) {
      val encoded = change.getString("valueBase64")
      if (encoded.length > SESSION_LIMIT) throw StateFailure("INVALID_REQUEST")
      val value = decode(encoded, SESSION_LIMIT)
      val parsed = parseObject(value)
      if (parsed.get("version") !is Number || parsed.get("version").toString() != "1") throw StateFailure("INVALID_REQUEST")
      validateProtocolValue(kind, parsed)
    }
  }

  private fun validSignalAddress(value: String): Boolean {
    val cut = value.lastIndexOf(':')
    return cut > 0 && value.substring(0, cut).none { it == '@' || it == '/' || it == '\\' } &&
      Regex("0|[1-9][0-9]*").matches(value.substring(cut + 1)) && value.substring(cut + 1).toLongOrNull()?.let { it <= 4294967295L } == true
  }

  private fun validateProtocolValue(kind: String, value: JSONObject) {
    fun bytes(field: String, min: Int, max: Int): Int {
      if (value.get(field) !is String) throw StateFailure("INVALID_REQUEST")
      val count = decode(value.getString(field), max).size
      if (count !in min..max) throw StateFailure("INVALID_REQUEST")
      return count
    }
    fun number(field: String, max: Long, allowZero: Boolean = true): Long {
      val raw = value.get(field)
      val text = raw.toString()
      if (raw !is Number || !Regex(if (allowZero) "0|[1-9][0-9]*" else "[1-9][0-9]*").matches(text)) throw StateFailure("INVALID_REQUEST")
      val n = text.toLongOrNull() ?: throw StateFailure("INVALID_REQUEST")
      if (n > max) throw StateFailure("INVALID_REQUEST")
      return n
    }
    when (kind) {
      "device" -> {
        exact(value, "version", "noisePrivateKey", "identityPrivateKey", "signedPreKeyPrivate", "signedPreKeyId", "signedPreKeySignature", "registrationId", "advSecretKey", "id", "lid", "account", "platform", "businessName", "pushName", "facebookUuid", "lidMigrationTimestamp", "companionMetaNonce")
        for (field in listOf("noisePrivateKey", "identityPrivateKey", "signedPreKeyPrivate", "advSecretKey")) bytes(field, 32, 32)
        bytes("signedPreKeySignature", 64, 64); bytes("account", 1, SESSION_LIMIT)
        number("signedPreKeyId", 4294967295L); number("registrationId", 4294967295L)
        for (field in listOf("id", "lid", "platform", "businessName", "pushName", "facebookUuid", "companionMetaNonce")) if (value.get(field) !is String) throw StateFailure("INVALID_REQUEST")
        if (!Regex("[0-9]+(?:_[0-9]+)?(?::[0-9]+)?@s\\.whatsapp\\.net").matches(value.getString("id")) || deviceAccount(value.getString("lid")) == null) throw StateFailure("INVALID_REQUEST")
        if (value.get("lidMigrationTimestamp") !is Number || value.get("lidMigrationTimestamp").toString().toLongOrNull() == null) throw StateFailure("INVALID_REQUEST")
      }
      "identity", "signal-session", "sender-key", "message-secret", "nct-salt" -> {
        exact(value, "version", "data"); bytes("data", if (kind == "identity") 32 else 1, if (kind == "identity") 32 else SESSION_LIMIT)
      }
      "prekey" -> { exact(value, "version", "privateKey", "uploaded"); bytes("privateKey", 32, 32); if (value.get("uploaded") !is Boolean) throw StateFailure("INVALID_REQUEST") }
      "prekey-state" -> { exact(value, "version", "nextId", "uploadedThrough"); val next = number("nextId", 4294967296L, false); if (number("uploadedThrough", 4294967295L) >= next) throw StateFailure("INVALID_REQUEST") }
      "app-state-key" -> { exact(value, "version", "data", "fingerprint", "timestamp"); bytes("data", 1, SESSION_LIMIT); bytes("fingerprint", 0, SESSION_LIMIT); number("timestamp", Long.MAX_VALUE) }
      "app-state-version" -> { exact(value, "version", "number", "hash"); number("number", Long.MAX_VALUE, false); bytes("hash", 128, 128) }
      "app-state-mac" -> { exact(value, "version", "mutationVersion", "valueMac"); number("mutationVersion", Long.MAX_VALUE, false); bytes("valueMac", 32, 32) }
      "contact" -> { exact(value, "version", "firstName", "fullName", "pushName", "businessName", "redactedPhone"); for (field in listOf("firstName", "fullName", "pushName", "businessName", "redactedPhone")) if (value.get(field) !is String) throw StateFailure("INVALID_REQUEST") }
      "chat-setting" -> { exact(value, "version", "mutedUntil", "pinned", "archived", "wasaRootSecretId"); if (value.get("mutedUntil") !is String || value.get("pinned") !is Boolean || value.get("archived") !is Boolean || value.get("wasaRootSecretId") !is String) throw StateFailure("INVALID_REQUEST") }
      "privacy-token" -> { exact(value, "version", "token", "timestamp", "senderTimestamp"); bytes("token", 1, SESSION_LIMIT); number("timestamp", Long.MAX_VALUE); if (value.get("senderTimestamp") != JSONObject.NULL) number("senderTimestamp", Long.MAX_VALUE) }
      "lid-mapping" -> { exact(value, "version", "lid"); if (value.get("lid") !is String || !ACCOUNT.matches(value.getString("lid"))) throw StateFailure("INVALID_REQUEST") }
      "retry-hash" -> { exact(value, "version", "insertTimeMs", "serverTimeSeconds"); number("insertTimeMs", Long.MAX_VALUE); number("serverTimeSeconds", Long.MAX_VALUE) }
    }
  }

  private fun validateProtocolRecords(records: JSONArray, account: String) {
    val seen = mutableSetOf<String>()
    val inverse = mutableMapOf<String, String>()
    var devices = 0
    for (i in 0 until records.length()) {
      val record = records.getJSONObject(i)
      exact(record, "recordType", "recordKey", "valueBase64")
      validateProtocolChange(JSONObject(record.toString()).put("operation", "put"))
      val kind = record.getString("recordType")
      val key = record.getString("recordKey")
      if (!seen.add("$kind\u0000$key")) throw StateFailure("INVALID_REQUEST")
      if (kind == "device") {
        devices++
        val value = parseObject(decode(record.getString("valueBase64"), SESSION_LIMIT))
        if (deviceAccount(value.getString("lid")) != account || value.getString("id").isEmpty()) throw StateFailure("INVALID_REQUEST")
      }
      if (kind == "lid-mapping") {
        val tuple = JSONArray(Base64.decode(key, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING).toString(Charsets.UTF_8))
        val pn = tuple.getString(0)
        val value = parseObject(decode(record.getString("valueBase64"), SESSION_LIMIT))
        val lid = value.getString("lid")
        if (!Regex("[0-9]+@s\\.whatsapp\\.net").matches(pn) || !ACCOUNT.matches(lid) ||
          (inverse[lid] != null && inverse[lid] != pn)) throw StateFailure("INVALID_REQUEST")
        inverse[lid] = pn
      }
    }
    if (devices != 1) throw StateFailure("INVALID_REQUEST")
  }

  private fun deviceAccount(jid: String): String? {
    val match = Regex("([0-9]+)(?:_[0-9]+)?(?::[0-9]+)?@lid").matchEntire(jid) ?: return null
    return match.groupValues[1] + "@lid"
  }

  fun endSession() {
    GLOBAL_LOCK.lock()
    try {
      registeredGeneration = null
      registeredAccount = null
      var state = open()
      val session = state.optJSONObject("session")
      if (session != null) {
        val id = session.getString("sessionKeyId")
        commit(revision.toString()) {
          it.put("session", JSONObject.NULL).put("sessionKeysToDelete", JSONArray().put(id))
            .put("androidService", JSONObject.NULL)
        }
        fault?.invoke("retiredPublished")
        state = open()
      }
      val retired = state.getJSONArray("sessionKeysToDelete")
      if (retired.length() == 1) {
        val id = retired.getString(0)
        if (id == recoveryId || !ID.matches(id)) throw StateFailure("SESSION_STATE_INVALID")
        fault?.invoke("deleteSessionKey")
        keys.deleteEntry(alias(id))
        fault?.invoke("keyDeleted")
        commit(revision.toString()) { it.put("sessionKeysToDelete", JSONArray()) }
      }
    } finally { current = null; GLOBAL_LOCK.unlock() }
  }

  private fun create(): JSONObject {
    storeId = newId(); recoveryId = newId(); readBudget = DEFAULT_BUFFER
    val record = JSONObject().put("status", "creating").put("storeId", storeId)
      .put("recoveryKeyId", recoveryId).put("readBudget", readBudget).put("preparedRevision", "0").put("provisionalSessionKeyId", JSONObject.NULL)
    ensureNamedKey(marker(storeId, recoveryId))
    ensureKey(recordAlias)
    writeRecord(record)
    fault?.invoke("creationRecord")
    ensureKey(recoveryId)
    fault?.invoke("recoveryKey")
    val state = emptyState()
    publish(state, BigInteger.ZERO)
    fault?.invoke("initialPublication")
    ensureNamedKey(readyPrefix + storeId)
    writeRecord(record.put("status", "ready"))
    ensureImagesDirectory()
    current = state
    observedPublication = publication
    return JSONObject(state.toString())
  }

  private fun emptyState() = JSONObject().put("session", JSONObject.NULL).put("pending", JSONArray())
    .put("sessionKeysToDelete", JSONArray())
    .put("options", JSONObject().put("maxRecoveryBufferBytes", DEFAULT_BUFFER).put("maxImageStorageBytes", 50L * 1024 * 1024))
    .put("androidService", JSONObject.NULL)

  private fun cleanupProvisional(record: JSONObject, state: JSONObject) {
    val id = record.optString("provisionalSessionKeyId")
    if (id.isEmpty() || id == "null") return
    if (!ID.matches(id) || id == recoveryId) throw StateFailure("SESSION_STATE_INVALID")
    if (state.optJSONObject("session")?.optString("sessionKeyId") != id) {
      fault?.invoke("cleanupProvisional")
      keys.deleteEntry(alias(id))
    }
    writeRecord(record.put("provisionalSessionKeyId", JSONObject.NULL))
  }

  private fun publish(state: JSONObject, nextRevision: BigInteger) {
    val plaintext = state.toString().toByteArray(Charsets.UTF_8)
    val header = JSONObject().put("formatVersion", 1).put("storeId", storeId).put("revision", nextRevision.toString())
      .put("recoveryKeyId", recoveryId).toString().toByteArray(Charsets.UTF_8)
    if (header.size > 4096 || plaintext.size > SESSION_LIMIT + readBudget + 4096) throw StateFailure("STATE_INVALID")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(recoveryId))
    val nonce = cipher.iv.also { if (it.size != 12) throw StateFailure("STORAGE_FAILED") }
    val prefix = ByteBuffer.allocate(8 + 4 + header.size + 12 + 8).order(ByteOrder.BIG_ENDIAN)
      .put("YOYOWA01".toByteArray(Charsets.US_ASCII)).putInt(header.size).put(header).put(nonce)
      .putLong(plaintext.size.toLong() + 16).array()
    fault?.invoke("cipher")
    cipher.updateAAD(prefix)
    val sealed = cipher.doFinal(plaintext)
    try {
      removeTemp(temporary)
      FileOutputStream(temporary).use { output ->
        fault?.invoke("write")
        output.write(prefix); output.write(sealed)
        fault?.invoke("sync")
        output.fd.sync()
        fault?.invoke("close")
      }
      uncertain = true
      fault?.invoke("replace")
      Os.rename(temporary.path, published.path)
      publication++
      fault?.invoke("directorySync")
      syncDirectory()
      revision = nextRevision
      fault?.invoke("response")
      uncertain = false
    } catch (e: Exception) {
      throw StateFailure("STORAGE_FAILED")
    }
  }

  private fun readSnapshot(file: File, bound: Long): JSONObject {
    val maximum = SESSION_LIMIT.toLong() + bound + 8244
    if (!file.isFile || file.length() < 8 + 4 + 12 + 8 + 16 || file.length() > maximum || file.length() > Int.MAX_VALUE) throw StateFailure("SESSION_STATE_INVALID")
    val bytes = ByteArray(file.length().toInt())
    FileInputStream(file).use { input ->
      var offset = 0
      while (offset < bytes.size) {
        val count = input.read(bytes, offset, bytes.size - offset)
        if (count <= 0) throw StateFailure("SESSION_STATE_INVALID")
        offset += count
      }
      if (input.read() != -1) throw StateFailure("SESSION_STATE_INVALID")
    }
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
    val magic = ByteArray(8).also(buffer::get)
    if (!magic.contentEquals("YOYOWA01".toByteArray(Charsets.US_ASCII))) throw StateFailure("SESSION_STATE_INVALID")
    val length = buffer.getInt()
    if (length <= 0 || length > 4096 || length > buffer.remaining() - 36) throw StateFailure("SESSION_STATE_INVALID")
    val headerBytes = ByteArray(length).also(buffer::get)
    val header = parseObject(headerBytes)
    exact(header, "formatVersion", "storeId", "revision", "recoveryKeyId")
    strings(header, "storeId", "revision", "recoveryKeyId")
    if (header.get("formatVersion") !is Number || header.get("formatVersion").toString() != "1" || header.getString("storeId") != storeId || header.getString("recoveryKeyId") != recoveryId) throw StateFailure("SESSION_STATE_INVALID")
    if (header.get("revision") !is String) throw StateFailure("SESSION_STATE_INVALID")
    val nextRevision = parseRevision(header.getString("revision"))
    val nonce = ByteArray(12).also(buffer::get)
    val ciphertextLength = buffer.getLong()
    if (ciphertextLength < 16 || ciphertextLength > maximum || ciphertextLength != buffer.remaining().toLong()) throw StateFailure("SESSION_STATE_INVALID")
    val prefix = bytes.copyOfRange(0, buffer.position())
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getKey(recoveryId), GCMParameterSpec(128, nonce))
    cipher.updateAAD(prefix)
    val plaintext = cipher.doFinal(bytes, buffer.position(), ciphertextLength.toInt())
    val state = parseObject(plaintext)
    validateState(state, nextRevision, bound, true)
    revision = nextRevision
    return state
  }

  private fun validateState(state: JSONObject, atRevision: BigInteger, bound: Long, allowSessionFailure: Boolean = false) {
    exact(state, "session", "pending", "sessionKeysToDelete", "options", "androidService")
    val options = state.getJSONObject("options")
    exact(options, "maxRecoveryBufferBytes", "maxImageStorageBytes")
    for (key in listOf("maxRecoveryBufferBytes", "maxImageStorageBytes")) {
      val value = options.get(key)
      val number = value.toString().toLongOrNull()
      if (value !is Number || !Regex("[1-9][0-9]*").matches(value.toString()) || number == null || number !in 1L..9007199254740991L) throw StateFailure("SESSION_STATE_INVALID")
    }
    val service = state.optJSONObject("androidService")
    if (service != null) {
      exact(service, "receiveRequested", "accountId")
      if (service.opt("accountId") != JSONObject.NULL) strings(service, "accountId")
      if (service.get("receiveRequested") !is Boolean || (service.opt("accountId") != JSONObject.NULL && !ACCOUNT.matches(service.getString("accountId")))) throw StateFailure("SESSION_STATE_INVALID")
    } else if (state.get("androidService") != JSONObject.NULL) throw StateFailure("SESSION_STATE_INVALID")
    val session = state.optJSONObject("session")
    val sessionSize = session?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 0
    if (session != null) {
      exact(session, "accountId", "sessionKeyId", "sessionRevision", "nonceBase64", "ciphertextBase64")
      strings(session, "accountId", "sessionKeyId", "sessionRevision", "nonceBase64", "ciphertextBase64")
      val id = session.getString("sessionKeyId")
      if (session.get("sessionRevision") !is String) throw StateFailure("SESSION_STATE_INVALID")
      val sessionRevision = parseRevision(session.getString("sessionRevision"))
      if (!ACCOUNT.matches(session.getString("accountId")) || !ID.matches(id) || id == recoveryId || sessionRevision > atRevision) throw StateFailure("SESSION_STATE_INVALID")
      val nonce = decode(session.getString("nonceBase64"), 12)
      if (nonce.size != 12) throw StateFailure("SESSION_STATE_INVALID")
      if (sessionSize > SESSION_LIMIT) {
        if (!allowSessionFailure) throw StateFailure("SESSION_STORAGE_LIMIT_REACHED")
        canonicalBase64(session.getString("ciphertextBase64"))
        if (session.getString("ciphertextBase64").length < 24) throw StateFailure("SESSION_STATE_INVALID")
        sessionUsable = false
      } else {
        val ciphertext = decode(session.getString("ciphertextBase64"), SESSION_LIMIT)
        if (ciphertext.size < 16) throw StateFailure("SESSION_STATE_INVALID")
        try {
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          cipher.init(Cipher.DECRYPT_MODE, getKey(id), GCMParameterSpec(128, nonce))
          cipher.updateAAD(sessionAad(storeId, session.getString("accountId"), id, sessionRevision.toString()))
          val protocol = parseObject(cipher.doFinal(ciphertext))
          exact(protocol, "protocolSchemaVersion", "records")
          if (protocol.get("protocolSchemaVersion") !is Number || protocol.get("protocolSchemaVersion").toString() != "1" || protocol.get("records") !is JSONArray) throw StateFailure("SESSION_STATE_INVALID")
          sessionUsable = true
        } catch (e: Exception) {
          sessionUsable = false
          if (!allowSessionFailure) throw StateFailure("SESSION_STATE_INVALID")
        }
      }
    } else if (state.get("session") != JSONObject.NULL) throw StateFailure("SESSION_STATE_INVALID")
    else sessionUsable = true
    if (service?.getBoolean("receiveRequested") == true &&
      (session == null || service.getString("accountId") != session.getString("accountId"))) throw StateFailure("SESSION_STATE_INVALID")
    val retired = state.getJSONArray("sessionKeysToDelete")
    if (retired.length() == 1 && retired.get(0) !is String) throw StateFailure("SESSION_STATE_INVALID")
    if (retired.length() > 1 || (retired.length() == 1 && (!ID.matches(retired.getString(0)) || retired.getString(0) == recoveryId || retired.getString(0) == session?.optString("sessionKeyId")))) throw StateFailure("SESSION_STATE_INVALID")
    val pending = state.getJSONArray("pending")
    if (pending.toString().toByteArray(Charsets.UTF_8).size > bound) throw StateFailure("SESSION_STATE_INVALID")
    val used = mutableSetOf<String>()
    val deliveryIds = mutableSetOf<String>()
    for (index in 0 until pending.length()) {
      val item = pending.getJSONObject(index)
      exact(item, "deliveryId", "accountId", "createdRevision", "createdOrdinal", "source", "identityState", "recovery", *(if (item.has("message")) arrayOf("message") else emptyArray()))
      strings(item, "deliveryId", "accountId", "createdRevision", "source", "identityState")
      if (!DELIVERY.matches(item.getString("deliveryId")) || !ACCOUNT.matches(item.getString("accountId"))) throw StateFailure("SESSION_STATE_INVALID")
      if (item.get("createdRevision") !is String) throw StateFailure("SESSION_STATE_INVALID")
      val created = parseRevision(item.getString("createdRevision"))
      val rawOrdinal = item.get("createdOrdinal")
      if (rawOrdinal !is Number || !Regex("0|[1-9][0-9]*").matches(rawOrdinal.toString())) throw StateFailure("SESSION_STATE_INVALID")
      val ordinal = rawOrdinal.toString().toLongOrNull() ?: throw StateFailure("SESSION_STATE_INVALID")
      if (created > atRevision || ordinal !in 0L..4294967295L || !used.add("$created:$ordinal") || !deliveryIds.add(item.getString("deliveryId"))) throw StateFailure("SESSION_STATE_INVALID")
      if (item.getString("source") !in listOf("live", "history") || item.getString("identityState") !in listOf("pendingLid", "resolved")) throw StateFailure("SESSION_STATE_INVALID")
      if ((item.getString("identityState") == "resolved") != item.has("message")) throw StateFailure("SESSION_STATE_INVALID")
      if (item.has("message")) validateMessage(item.get("message") as? JSONObject ?: throw StateFailure("SESSION_STATE_INVALID"), item.getString("accountId"))
      val recovery = item.getJSONObject("recovery")
      exact(recovery, "messageInfoJson", "items")
      strings(recovery, "messageInfoJson")
      parseObject(recovery.getString("messageInfoJson").toByteArray(Charsets.UTF_8))
      val children = recovery.getJSONArray("items")
      for (i in 0 until children.length()) {
        val child = children.getJSONObject(i)
        exact(child, "format", "plaintextBase64", *(if (child.has("ciphertextHashBase64")) arrayOf("ciphertextHashBase64") else emptyArray()))
        strings(child, "format", "plaintextBase64")
        if (child.has("ciphertextHashBase64")) strings(child, "ciphertextHashBase64")
        val format = child.getString("format")
        if (format !in listOf("v2", "v3", "history")) throw StateFailure("SESSION_STATE_INVALID")
        if ((item.getString("source") == "history") != (format == "history")) throw StateFailure("SESSION_STATE_INVALID")
        decode(child.getString("plaintextBase64"), minOf(bound, Int.MAX_VALUE.toLong()).toInt())
        if (format == "history" && child.has("ciphertextHashBase64")) throw StateFailure("SESSION_STATE_INVALID")
        if (format != "history" && (!child.has("ciphertextHashBase64") || decode(child.getString("ciphertextHashBase64"), 32).size != 32)) throw StateFailure("SESSION_STATE_INVALID")
      }
    }
    val control = state.toString().toByteArray(Charsets.UTF_8).size - (session?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 4) - pending.toString().toByteArray(Charsets.UTF_8).size
    if (control > 4096) throw StateFailure("SESSION_STATE_INVALID")
  }

  private fun validateMessage(message: JSONObject, account: String) {
    val fields = mutableListOf("id", "accountId", "whatsappMessageId", "chatId", "direction", "timestamp")
    if (message.has("text")) fields.add("text")
    if (message.has("image")) fields.add("image")
    exact(message, *fields.toTypedArray())
    strings(message, "id", "accountId", "whatsappMessageId", "chatId", "direction")
    val chat = message.getString("chatId")
    val whatsappId = message.getString("whatsappMessageId")
    if (message.getString("accountId") != account || !ACCOUNT.matches(chat) || whatsappId.isEmpty() || message.getString("direction") !in listOf("incoming", "outgoing")) throw StateFailure("SESSION_STATE_INVALID")
    val timestamp = message.get("timestamp")
    if (timestamp !is Number || !Regex("0|[1-9][0-9]*").matches(timestamp.toString()) || timestamp.toString().toLongOrNull()?.let { it <= 9007199254740991L } != true) throw StateFailure("SESSION_STATE_INVALID")
    if (message.has("text") && message.get("text") !is String) throw StateFailure("SESSION_STATE_INVALID")
    val id = message.getString("id")
    val prefix = "wa-message:v1:"
    if (!id.startsWith(prefix)) throw StateFailure("SESSION_STATE_INVALID")
    val encoded = id.removePrefix(prefix)
    if (encoded.length > 8192 || !Regex("[A-Za-z0-9_-]+").matches(encoded)) throw StateFailure("SESSION_STATE_INVALID")
    val tupleBytes = Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    if (Base64.encodeToString(tupleBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) != encoded) throw StateFailure("SESSION_STATE_INVALID")
    val tupleText = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(tupleBytes)).toString()
    StrictJson.check(tupleText)
    val tuple = JSONArray(tupleText)
    if (tuple.length() != 3 || (0..2).any { tuple.get(it) !is String } || tuple.getString(0) != account || tuple.getString(1) != chat || tuple.getString(2) != whatsappId) throw StateFailure("SESSION_STATE_INVALID")
    if (message.has("image")) {
      val image = message.get("image") as? JSONObject ?: throw StateFailure("SESSION_STATE_INVALID")
      exact(image, *(listOfNotNull("reference", if (image.has("mimeType")) "mimeType" else null, if (image.has("size")) "size" else null).toTypedArray()))
      val reference = image.getJSONObject("reference")
      exact(reference, "messageId", "downloadReference")
      strings(reference, "messageId", "downloadReference")
      if (reference.getString("messageId") != id || reference.getString("downloadReference").isEmpty()) throw StateFailure("SESSION_STATE_INVALID")
      if (image.has("mimeType") && image.get("mimeType") !is String) throw StateFailure("SESSION_STATE_INVALID")
      if (image.has("size")) {
        val size = image.get("size")
        if (size !is Number || !Regex("0|[1-9][0-9]*").matches(size.toString()) || size.toString().toLongOrNull()?.let { it <= 9007199254740991L } != true) throw StateFailure("SESSION_STATE_INVALID")
      }
    }
  }

  private fun readRecord(): JSONObject? {
    if (!existsChecked(recordFile)) return null
    val key = getKey(recordAlias)
    val size = recordFile.length()
    if (size !in 29L..4096L) throw StateFailure("SESSION_STATE_INVALID")
    val bytes = ByteArray(size.toInt())
    FileInputStream(recordFile).use { input ->
      var offset = 0
      while (offset < bytes.size) {
        val count = input.read(bytes, offset, bytes.size - offset)
        if (count <= 0) throw StateFailure("SESSION_STATE_INVALID")
        offset += count
      }
      if (input.read() != -1) throw StateFailure("SESSION_STATE_INVALID")
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    val record = parseObject(cipher.doFinal(bytes, 12, bytes.size - 12))
    exact(record, "status", "storeId", "recoveryKeyId", "readBudget", "preparedRevision", "provisionalSessionKeyId")
    strings(record, "status", "storeId", "recoveryKeyId", "preparedRevision")
    if (record.opt("provisionalSessionKeyId") != JSONObject.NULL) strings(record, "provisionalSessionKeyId")
    val budget = record.get("readBudget")
    val budgetValue = budget.toString().toLongOrNull()
    if (record.getString("status") !in listOf("creating", "ready") || !ID.matches(record.getString("storeId")) || !ID.matches(record.getString("recoveryKeyId")) || budget !is Number || !Regex("[1-9][0-9]*").matches(budget.toString()) || budgetValue == null || budgetValue !in 1L..9007199254740991L || parseRevision(record.getString("preparedRevision")) > MAX_REVISION) throw StateFailure("SESSION_STATE_INVALID")
    return record
  }

  private fun writeRecord(record: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(recordAlias))
    val nonce = cipher.iv.also { if (it.size != 12) throw StateFailure("STORAGE_FAILED") }
    val bytes = nonce + cipher.doFinal(record.toString().toByteArray(Charsets.UTF_8))
    removeTemp(recordNext)
    FileOutputStream(recordNext).use { it.write(bytes); it.fd.sync() }
    uncertain = true
    Os.rename(recordNext.path, recordFile.path)
    syncDirectory()
    fault?.invoke("recordResponse")
    uncertain = false
  }

  private fun ensureKey(id: String) = ensureNamedKey(if (id == recordAlias) id else alias(id))

  private fun ensureNamedKey(name: String) {
    if (keys.containsAlias(name)) return
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false)
    if (Build.VERSION.SDK_INT >= 28) spec.setUnlockedDeviceRequired(false)
    generator.init(spec.build()); generator.generateKey()
  }

  private fun getKey(id: String): SecretKey = (keys.getKey(if (id == recordAlias) id else alias(id), null) as? SecretKey)
    ?: throw StateFailure("SESSION_STATE_INVALID")

  private fun encrypt(id: String, bytes: ByteArray, aad: ByteArray): Pair<ByteArray, ByteArray> {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(id))
    val nonce = cipher.iv.also { if (it.size != 12) throw StateFailure("STORAGE_FAILED") }
    cipher.updateAAD(aad)
    return nonce to cipher.doFinal(bytes)
  }

  private fun removeTemp(file: File) {
    if (existsChecked(file) && (file.isDirectory || !file.delete())) throw StateFailure("STORAGE_FAILED")
  }

  private fun ensureImagesDirectory() {
    val images = File(directory, "images")
    if (!existsChecked(images) && !images.mkdir()) throw StateFailure("STORAGE_FAILED")
    if (!images.isDirectory) throw StateFailure("STORAGE_FAILED")
  }

  private fun existsChecked(file: File): Boolean = try {
    Os.stat(file.path)
    true
  } catch (e: ErrnoException) {
    if (e.errno == OsConstants.ENOENT) false else throw StateFailure("STORAGE_FAILED")
  }

  private fun syncDirectory() {
    val fd = Os.open(directory.path, OsConstants.O_RDONLY, 0)
    try { Os.fsync(fd) } finally { Os.close(fd) }
  }

  companion object {
    private val GLOBAL_LOCK = ReentrantLock()
    private var publication = 0L
    private const val SESSION_LIMIT = 16 * 1024 * 1024
    private const val DEFAULT_BUFFER = 10L * 1024 * 1024
    private val MAX_REVISION = BigInteger.ONE.shiftLeft(64) - BigInteger.ONE
    private val ID = Regex("[0-9a-f]{32}")
    private val ACCOUNT = Regex("[0-9]+@lid")
    private val DELIVERY = Regex("wa-delivery:v1:[0-9a-f]{32}")
    private fun newId(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private fun parseRevision(value: String): BigInteger {
      if (!Regex("0|[1-9][0-9]*").matches(value) || value.length > 20) throw StateFailure("SESSION_STATE_INVALID")
      return BigInteger(value).also { if (it > MAX_REVISION) throw StateFailure("SESSION_STATE_INVALID") }
    }
    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun canonicalBase64(value: String) {
      if (value.length % 4 != 0) throw StateFailure("SESSION_STATE_INVALID")
      var padding = 0
      var last = 0
      for (char in value) {
        if (char == '=') { padding++; continue }
        if (padding != 0) throw StateFailure("SESSION_STATE_INVALID")
        last = when (char) {
          in 'A'..'Z' -> char - 'A'
          in 'a'..'z' -> char - 'a' + 26
          in '0'..'9' -> char - '0' + 52
          '+' -> 62
          '/' -> 63
          else -> -1
        }
        if (last < 0) throw StateFailure("SESSION_STATE_INVALID")
      }
      if (padding > 2 || (padding != 0 && value.length < 4) ||
        (padding != 0 && (last and ((1 shl (2 * padding)) - 1)) != 0)) throw StateFailure("SESSION_STATE_INVALID")
    }
    private fun decode(value: String, max: Int): ByteArray {
      if (value.length > ((max + 2L) / 3 * 4)) throw StateFailure("SESSION_STATE_INVALID")
      canonicalBase64(value)
      val bytes = Base64.decode(value, Base64.DEFAULT)
      if (bytes.size > max || b64(bytes) != value) throw StateFailure("SESSION_STATE_INVALID")
      return bytes
    }
    private fun sessionAad(store: String, account: String, key: String, revision: String) =
      JSONArray().put("yoyos-whatsapp-session").put(1).put(store).put(account).put(key).put(revision).toString().toByteArray(Charsets.UTF_8)
    private fun exact(obj: JSONObject, vararg fields: String) {
      if (obj.length() != fields.size || obj.keys().asSequence().any { it !in fields }) throw StateFailure("SESSION_STATE_INVALID")
    }
    private fun strings(obj: JSONObject, vararg fields: String) {
      if (fields.any { obj.opt(it) !is String }) throw StateFailure("SESSION_STATE_INVALID")
    }
    internal fun parseObject(bytes: ByteArray): JSONObject {
      val decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
      StrictJson.check(decoded)
      return JSONObject(decoded)
    }
  }
}
