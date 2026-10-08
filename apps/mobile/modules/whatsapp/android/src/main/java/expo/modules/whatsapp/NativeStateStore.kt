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
  private val random = SecureRandom()
  private var current: JSONObject? = null
  private var storeId = ""
  private var recoveryId = ""
  private var revision = BigInteger.ZERO
  private var readBudget = DEFAULT_BUFFER
  private var uncertain = false
  private var sessionUsable = true

  // The secure creation record is a Keystore-backed encrypted file. Its key is created before
  // the first state key; a partial record cannot be mistaken for an empty installation.
  private val recordFile get() = File(directory, "creation.bin")
  private val recordNext get() = File(directory, "creation.next")
  private val recordAlias = "$keySpace.creation-key"
  private val markerPrefix = "$keySpace.creation."
  private val readyPrefix = "$keySpace.ready."
  private fun marker(store: String, recovery: String) = "$markerPrefix$store.$recovery"
  private fun alias(id: String) = "$keySpace.key.$id"

  @Synchronized fun open(): JSONObject {
    GLOBAL_LOCK.lock()
    try {
      if (Build.VERSION.SDK_INT >= 24 && !context.getSystemService(UserManager::class.java).isUserUnlocked) throw StateFailure("STORAGE_FAILED")
      if (uncertain) { current = null; uncertain = false }
      current?.let { return JSONObject(it.toString()) }
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
        if (existsChecked(recordNext) && !recordNext.delete()) throw StateFailure("STORAGE_FAILED")
        if (markers.size == 1) {
          val parts = markers.single().removePrefix(markerPrefix).split('.')
          if (parts.size != 2 || !ID.matches(parts[0]) || !ID.matches(parts[1])) throw StateFailure("SESSION_STATE_INVALID")
          if (existsChecked(temporary) && !temporary.delete()) throw StateFailure("STORAGE_FAILED")
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
        if (record.getString("status") == "creating") writeRecord(record.put("status", "ready"))
        ensureNamedKey(readyPrefix + storeId)
        if (existsChecked(temporary) && !temporary.delete()) throw StateFailure("STORAGE_FAILED")
        if (existsChecked(recordNext) && !recordNext.delete()) throw StateFailure("STORAGE_FAILED")
        ensureImagesDirectory()
        current = state
        cleanupProvisional(record, state)
        if (state.getJSONArray("sessionKeysToDelete").length() > 0) endSession()
        return JSONObject((current ?: state).toString())
      }
      if (record.getString("status") != "creating") throw StateFailure("SESSION_STATE_INVALID")
      if (existsChecked(temporary) && !temporary.delete()) throw StateFailure("STORAGE_FAILED")
      ensureKey(recoveryId)
      val state = emptyState()
      publish(state, BigInteger.ZERO)
      fault?.invoke("initialPublication")
      writeRecord(record.put("status", "ready"))
      ensureNamedKey(readyPrefix + storeId)
      ensureImagesDirectory()
      current = state
      return JSONObject(state.toString())
    } finally { GLOBAL_LOCK.unlock() }
  }

  @Synchronized fun commit(expectedRevision: String, change: (JSONObject) -> JSONObject): JSONObject {
    GLOBAL_LOCK.lock()
    try {
      val old = open()
      if (parseRevision(expectedRevision) != revision) throw StateFailure("SESSION_REVISION_MISMATCH")
      if (revision == MAX_REVISION) throw StateFailure("STATE_INVALID")
      val next = change(old)
      val requested = next.getJSONObject("options").getLong("maxRecoveryBufferBytes")
      val record = readRecord() ?: throw StateFailure("SESSION_STATE_INVALID")
      val nextBound = maxOf(readBudget, requested)
      writeRecord(record.put("readBudget", nextBound).put("preparedRevision", (revision + BigInteger.ONE).toString()))
      readBudget = nextBound
      validateState(next, revision + BigInteger.ONE, readBudget, !sessionUsable && next.opt("session")?.toString() == old.opt("session")?.toString())
      publish(next, revision + BigInteger.ONE)
      current = next
      return JSONObject(next.toString())
    } finally { GLOBAL_LOCK.unlock() }
  }

  @Synchronized fun beginSession(accountId: String, protocolBytes: ByteArray) {
    GLOBAL_LOCK.lock()
    try {
      val state = open()
      if (protocolBytes.size > SESSION_LIMIT) throw StateFailure("SESSION_STORAGE_LIMIT_REACHED")
      if (state.opt("session") != JSONObject.NULL || state.getJSONArray("sessionKeysToDelete").length() != 0) throw StateFailure("SESSION_STATE_INVALID")
      if (!ACCOUNT.matches(accountId)) throw StateFailure("INVALID_INPUT")
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
    } finally { GLOBAL_LOCK.unlock() }
  }

  @Synchronized fun canRestoreSession(): Boolean {
    GLOBAL_LOCK.lock()
    try {
      open()
      return sessionUsable
    } finally { GLOBAL_LOCK.unlock() }
  }

  @Synchronized fun endSession() {
    GLOBAL_LOCK.lock()
    try {
      var state = open()
      val session = state.optJSONObject("session")
      if (session != null) {
        val id = session.getString("sessionKeyId")
        commit(revision.toString()) { it.put("session", JSONObject.NULL).put("sessionKeysToDelete", JSONArray().put(id)) }
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
    } finally { GLOBAL_LOCK.unlock() }
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
    writeRecord(record.put("status", "ready"))
    ensureNamedKey(readyPrefix + storeId)
    ensureImagesDirectory()
    current = state
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
    if (state.optJSONObject("session")?.optString("sessionKeyId") != id) keys.deleteEntry(alias(id))
    writeRecord(record.put("provisionalSessionKeyId", JSONObject.NULL))
  }

  private fun publish(state: JSONObject, nextRevision: BigInteger) {
    val plaintext = state.toString().toByteArray(Charsets.UTF_8)
    val header = JSONObject().put("formatVersion", 1).put("storeId", storeId).put("revision", nextRevision.toString())
      .put("recoveryKeyId", recoveryId).toString().toByteArray(Charsets.UTF_8)
    if (header.size > 4096 || plaintext.size > SESSION_LIMIT + readBudget + 4096) throw StateFailure("STATE_INVALID")
    val nonce = ByteArray(12).also(random::nextBytes)
    val prefix = ByteBuffer.allocate(8 + 4 + header.size + 12 + 8).order(ByteOrder.BIG_ENDIAN)
      .put("YOYOWA01".toByteArray(Charsets.US_ASCII)).putInt(header.size).put(header).put(nonce)
      .putLong(plaintext.size.toLong() + 16).array()
    fault?.invoke("cipher")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(recoveryId), GCMParameterSpec(128, nonce))
    cipher.updateAAD(prefix)
    val sealed = cipher.doFinal(plaintext)
    try {
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
      if (value !is Number || value.toString().contains('.') || value.toLong() !in 1L..9007199254740991L) throw StateFailure("SESSION_STATE_INVALID")
    }
    val service = state.optJSONObject("androidService")
    if (service != null) {
      exact(service, "receiveRequested", "accountId")
      if (service.get("receiveRequested") !is Boolean || (service.opt("accountId") != JSONObject.NULL && !ACCOUNT.matches(service.getString("accountId")))) throw StateFailure("SESSION_STATE_INVALID")
    } else if (state.get("androidService") != JSONObject.NULL) throw StateFailure("SESSION_STATE_INVALID")
    val session = state.optJSONObject("session")
    if (session != null) {
      exact(session, "accountId", "sessionKeyId", "sessionRevision", "nonceBase64", "ciphertextBase64")
      val id = session.getString("sessionKeyId")
      if (session.get("sessionRevision") !is String) throw StateFailure("SESSION_STATE_INVALID")
      val sessionRevision = parseRevision(session.getString("sessionRevision"))
      if (!ACCOUNT.matches(session.getString("accountId")) || !ID.matches(id) || id == recoveryId || sessionRevision > atRevision) throw StateFailure("SESSION_STATE_INVALID")
      val nonce = decode(session.getString("nonceBase64"), 12)
      val ciphertext = decode(session.getString("ciphertextBase64"), SESSION_LIMIT)
      if (nonce.size != 12 || ciphertext.size < 16) throw StateFailure("SESSION_STATE_INVALID")
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
    } else if (state.get("session") != JSONObject.NULL) throw StateFailure("SESSION_STATE_INVALID")
    else sessionUsable = true
    val retired = state.getJSONArray("sessionKeysToDelete")
    if (retired.length() > 1 || (retired.length() == 1 && (!ID.matches(retired.getString(0)) || retired.getString(0) == recoveryId || retired.getString(0) == session?.optString("sessionKeyId")))) throw StateFailure("SESSION_STATE_INVALID")
    val pending = state.getJSONArray("pending")
    if (pending.toString().toByteArray(Charsets.UTF_8).size > bound) throw StateFailure("SESSION_STATE_INVALID")
    val used = mutableSetOf<String>()
    val deliveryIds = mutableSetOf<String>()
    for (index in 0 until pending.length()) {
      val item = pending.getJSONObject(index)
      exact(item, "deliveryId", "accountId", "createdRevision", "createdOrdinal", "source", "identityState", "recovery", *(if (item.has("message")) arrayOf("message") else emptyArray()))
      if (!DELIVERY.matches(item.getString("deliveryId")) || !ACCOUNT.matches(item.getString("accountId"))) throw StateFailure("SESSION_STATE_INVALID")
      if (item.get("createdRevision") !is String) throw StateFailure("SESSION_STATE_INVALID")
      val created = parseRevision(item.getString("createdRevision"))
      val rawOrdinal = item.get("createdOrdinal")
      if (rawOrdinal !is Number || !Regex("0|[1-9][0-9]*").matches(rawOrdinal.toString())) throw StateFailure("SESSION_STATE_INVALID")
      val ordinal = rawOrdinal.toLong()
      if (created > atRevision || ordinal !in 0L..4294967295L || !used.add("$created:$ordinal") || !deliveryIds.add(item.getString("deliveryId"))) throw StateFailure("SESSION_STATE_INVALID")
      if (item.getString("source") !in listOf("live", "history") || item.getString("identityState") !in listOf("pendingLid", "resolved")) throw StateFailure("SESSION_STATE_INVALID")
      if ((item.getString("identityState") == "resolved") != item.has("message")) throw StateFailure("SESSION_STATE_INVALID")
      if (item.has("message")) validateMessage(item.get("message") as? JSONObject ?: throw StateFailure("SESSION_STATE_INVALID"), item.getString("accountId"))
      val recovery = item.getJSONObject("recovery")
      exact(recovery, "messageInfoJson", "items")
      parseObject(recovery.getString("messageInfoJson").toByteArray(Charsets.UTF_8))
      val children = recovery.getJSONArray("items")
      for (i in 0 until children.length()) {
        val child = children.getJSONObject(i)
        exact(child, "format", "plaintextBase64", *(if (child.has("ciphertextHashBase64")) arrayOf("ciphertextHashBase64") else emptyArray()))
        val format = child.getString("format")
        if (format !in listOf("v2", "v3", "history")) throw StateFailure("SESSION_STATE_INVALID")
        decode(child.getString("plaintextBase64"), minOf(bound, Int.MAX_VALUE.toLong()).toInt())
        if (format == "history" && child.has("ciphertextHashBase64")) throw StateFailure("SESSION_STATE_INVALID")
        if (format != "history" && (!child.has("ciphertextHashBase64") || decode(child.getString("ciphertextHashBase64"), 32).size != 32)) throw StateFailure("SESSION_STATE_INVALID")
      }
    }
    val control = state.toString().toByteArray(Charsets.UTF_8).size - (session?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 4) - pending.toString().toByteArray(Charsets.UTF_8).size
    if (control > 4096 || (session?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 0) > SESSION_LIMIT) throw StateFailure("SESSION_STATE_INVALID")
  }

  private fun validateMessage(message: JSONObject, account: String) {
    val fields = mutableListOf("id", "accountId", "whatsappMessageId", "chatId", "direction", "timestamp")
    if (message.has("text")) fields.add("text")
    if (message.has("image")) fields.add("image")
    exact(message, *fields.toTypedArray())
    val chat = message.getString("chatId")
    val whatsappId = message.getString("whatsappMessageId")
    if (message.getString("accountId") != account || !ACCOUNT.matches(chat) || whatsappId.isEmpty() || message.getString("direction") !in listOf("incoming", "outgoing")) throw StateFailure("SESSION_STATE_INVALID")
    val timestamp = message.get("timestamp")
    if (timestamp !is Number || !Regex("0|[1-9][0-9]*").matches(timestamp.toString()) || timestamp.toLong() > 9007199254740991L) throw StateFailure("SESSION_STATE_INVALID")
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
      if (reference.getString("messageId") != id || reference.getString("downloadReference").isEmpty()) throw StateFailure("SESSION_STATE_INVALID")
    }
  }

  private fun readRecord(): JSONObject? {
    if (!existsChecked(recordFile)) return null
    val key = getKey(recordAlias)
    if (recordFile.length() !in 29L..4096L) throw StateFailure("SESSION_STATE_INVALID")
    val bytes = recordFile.readBytes()
    if (bytes.size !in 29..4096) throw StateFailure("SESSION_STATE_INVALID")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    val record = parseObject(cipher.doFinal(bytes, 12, bytes.size - 12))
    exact(record, "status", "storeId", "recoveryKeyId", "readBudget", "preparedRevision", "provisionalSessionKeyId")
    if (record.getString("status") !in listOf("creating", "ready") || !ID.matches(record.getString("storeId")) || !ID.matches(record.getString("recoveryKeyId")) || record.getLong("readBudget") !in 1L..9007199254740991L || parseRevision(record.getString("preparedRevision")) > MAX_REVISION) throw StateFailure("SESSION_STATE_INVALID")
    return record
  }

  private fun writeRecord(record: JSONObject) {
    val nonce = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(recordAlias), GCMParameterSpec(128, nonce))
    val bytes = nonce + cipher.doFinal(record.toString().toByteArray(Charsets.UTF_8))
    FileOutputStream(recordNext).use { it.write(bytes); it.fd.sync() }
    uncertain = true
    Os.rename(recordNext.path, recordFile.path)
    syncDirectory()
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
    val nonce = ByteArray(12).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getKey(id), GCMParameterSpec(128, nonce))
    cipher.updateAAD(aad)
    return nonce to cipher.doFinal(bytes)
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
    val fd = Os.open(directory.path, OsConstants.O_RDONLY or OsConstants.O_DIRECTORY, 0)
    try { Os.fsync(fd) } finally { Os.close(fd) }
  }

  companion object {
    private val GLOBAL_LOCK = ReentrantLock()
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
    private fun decode(value: String, max: Int): ByteArray {
      if (value.length > ((max + 2L) / 3 * 4) || !Regex("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?").matches(value)) throw StateFailure("SESSION_STATE_INVALID")
      val bytes = Base64.decode(value, Base64.DEFAULT)
      if (bytes.size > max || b64(bytes) != value) throw StateFailure("SESSION_STATE_INVALID")
      return bytes
    }
    private fun sessionAad(store: String, account: String, key: String, revision: String) =
      JSONArray().put("yoyos-whatsapp-session").put(1).put(store).put(account).put(key).put(revision).toString().toByteArray(Charsets.UTF_8)
    private fun exact(obj: JSONObject, vararg fields: String) {
      if (obj.length() != fields.size || obj.keys().asSequence().any { it !in fields }) throw StateFailure("SESSION_STATE_INVALID")
    }
    private fun parseObject(bytes: ByteArray): JSONObject {
      val decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
      StrictJson.check(decoded)
      return JSONObject(decoded)
    }
  }
}
