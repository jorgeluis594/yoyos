package expo.modules.whatsapp

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class StateStoreInstrumentedTest {
  private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val freshRoot get() = File(base.noBackupFilesDir, "state-test-${java.util.UUID.randomUUID()}")
  private fun contextFor(root: File) = object : ContextWrapper(base) {
    override fun getNoBackupFilesDir(): File = root
  }
  private fun directory(root: File) = File(root, "whatsapp")
  private fun makeStore(root: File, fault: ((String) -> Unit)? = null) =
    NativeStateStore(contextFor(root), root.name.removePrefix("state-test-").replace("-", ""), fault)

  @Test fun strictJsonRejectsDuplicateKeysAndMalformedNumbers() {
    for (value in listOf("{\"a\":1,\"a\":2}", "{\"a\":1,\"\\u0061\":2}", "{\"a\":01}", "{\"a\":1,}", "{\"a\":+1}", "{\"a\":NaN}", "{\"a\":\"\\ud800\"}")) {
      assertThrows(StateFailure::class.java) { StrictJson.check(value) }
    }
    StrictJson.check("{\"a\":[true,null,3]}")
    assertThrows(StateFailure::class.java) { StrictJson.check("[".repeat(65) + "0" + "]".repeat(65)) }
    assertThrows(Exception::class.java) { NativeStateStore.parseObject(byteArrayOf(0x7b, 0x22, 0xc3.toByte(), 0x28, 0x22, 0x7d)) }
  }

  @Test fun publishedStateSurvivesRestartAndIgnoresPreparation() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    assertEquals(true, File(directory(root), "images").isDirectory)
    val revision = currentRevision(root)
    store.commit(revision) { it.getJSONObject("options").put("maxRecoveryBufferBytes", 20L * 1024 * 1024); it }
    File(directory(root), "state.next").writeText("uncommitted")
    val recovered = makeStore(root).open()
    assertEquals(20L * 1024 * 1024, recovered.getJSONObject("options").getLong("maxRecoveryBufferBytes"))
    assertFalse(File(directory(root), "state.next").exists())
  }

  @Test fun recoveryOnlyCommitPreservesSessionCiphertext() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val original = store.open().getJSONObject("session").getString("ciphertextBase64")
    val next = store.commit(currentRevision(root)) { it }
    assertEquals(original, next.getJSONObject("session").getString("ciphertextBase64"))
    assertEquals(true, makeStore(root).canRestoreSession())
    val firstKey = store.open().getJSONObject("session").getString("sessionKeyId")
    val firstNonce = store.open().getJSONObject("session").getString("nonceBase64")
    store.endSession()
    assertEquals(org.json.JSONObject.NULL, makeStore(root).open().get("session"))
    store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    assertEquals(false, firstKey == store.open().getJSONObject("session").getString("sessionKeyId"))
    assertEquals(false, firstNonce == store.open().getJSONObject("session").getString("nonceBase64"))
  }

  @Test fun storageKeysAreNonexportableAndDoNotRequirePerUseAuthentication() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    val file = File(directory(root), "state.bin").readBytes()
    val length = java.nio.ByteBuffer.wrap(file, 8, 4).int
    val header = org.json.JSONObject(String(file, 12, length, Charsets.UTF_8))
    val namespace = root.name.removePrefix("state-test-").replace("-", "")
    val keys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val key = keys.getKey("yoyos.whatsapp.test.$namespace.key.${header.getString("recoveryKeyId")}", null) as javax.crypto.SecretKey
    assertEquals(null, key.encoded)
    val info = javax.crypto.SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
      .getKeySpec(key, android.security.keystore.KeyInfo::class.java) as android.security.keystore.KeyInfo
    assertFalse(info.isUserAuthenticationRequired)
    if (android.os.Build.VERSION.SDK_INT >= 28) assertFalse(info.isUnlockedDeviceRequired)
  }

  @Test fun sessionFieldsAreAuthenticatedIndependentlyOfRecoveryRevision() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val original = store.open().getJSONObject("session")
    for (change in listOf<(org.json.JSONObject) -> Unit>(
      { it.put("accountId", "456@lid") },
      { it.put("sessionRevision", "0") },
      { it.put("sessionKeyId", (if (it.getString("sessionKeyId")[0] == '0') "1" else "0") + it.getString("sessionKeyId").drop(1)) },
      { it.put("nonceBase64", (if (it.getString("nonceBase64")[0] == 'A') "B" else "A") + it.getString("nonceBase64").drop(1)) },
      { it.put("ciphertextBase64", (if (it.getString("ciphertextBase64")[0] == 'A') "B" else "A") + it.getString("ciphertextBase64").drop(1)) },
    )) {
      assertThrows(Exception::class.java) {
        store.commit("1") { it.put("session", org.json.JSONObject(original.toString()).also(change)) }
      }
      assertEquals("1", currentRevision(root))
    }
  }

  @Test fun interruptedCreationResumesWithoutPromotingPreparation() {
    for (phase in listOf("recordResponse", "creationRecord", "recoveryKey", "initialPublication")) {
      val root = freshRoot
      assertThrows(StateFailure::class.java) {
        makeStore(root) { if (it == phase) throw StateFailure("STORAGE_FAILED") }.open()
      }
      val recovered = makeStore(root).open()
      assertEquals(org.json.JSONObject.NULL, recovered.get("session"))
      assertEquals("0", currentRevision(root))
    }
  }

  @Test fun provisionalSessionRecoveryKeepsOnlyPublishedSession() {
    for (phase in listOf("provisionalRecord", "sessionKey", "sessionPublished")) {
      val root = freshRoot
      var active = false
      val store = makeStore(root) { if (active && it == phase) throw StateFailure("STORAGE_FAILED") }
      store.open(); active = true
      assertThrows(StateFailure::class.java) {
        store.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
      }
      val recovered = makeStore(root).open()
      assertEquals(phase == "sessionPublished", recovered.get("session") != org.json.JSONObject.NULL)
    }
  }

  @Test fun sameWriterRetryRemovesOnlyItsUnpublishedSessionKey() {
    val root = freshRoot
    var fail = true
    var cleanupFail = false
    val writer = makeStore(root) {
      if (it == "sessionKey" && fail) { fail = false; throw StateFailure("STORAGE_FAILED") }
      if (it == "cleanupProvisional" && cleanupFail) { cleanupFail = false; throw StateFailure("STORAGE_FAILED") }
    }
    writer.open()
    val prefix = "yoyos.whatsapp.test.${root.name.removePrefix("state-test-").replace("-", "")}.key."
    fun keys(): Set<String> {
      val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val result = mutableSetOf<String>()
      val aliases = store.aliases()
      while (aliases.hasMoreElements()) aliases.nextElement().let { if (it.startsWith(prefix)) result.add(it) }
      return result
    }
    val before = keys()
    assertThrows(StateFailure::class.java) { writer.beginSession("123@lid", "{}".toByteArray()) }
    assertEquals(before, keys())
    assertThrows(StateFailure::class.java) {
      writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    }
    val orphan = keys() - before
    assertEquals(1, orphan.size)
    cleanupFail = true
    assertThrows(StateFailure::class.java) {
      writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    }
    assertEquals(orphan, keys() - before)
    writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    assertFalse(keys().contains(orphan.single()))
    assertEquals(before.size + 1, keys().size)
  }

  @Test fun injectedPublicationFailuresPreserveAReadableRevision() {
    for (phase in listOf("recordResponse", "cipher", "write", "sync", "close", "replace", "directorySync", "response")) {
      val root = freshRoot
      var active = false
      val store = makeStore(root) { reached ->
        if (active && reached == phase) throw StateFailure("STORAGE_FAILED")
      }
      store.open()
      active = true
      assertThrows(StateFailure::class.java) { store.commit("0") { it } }
      val expected = if (phase == "directorySync" || phase == "response") "1" else "0"
      assertEquals(expected, currentRevision(root))
      makeStore(root).open()
    }
  }

  @Test fun uncertainPublicationIsRereadBeforeNextMutation() {
    for (phase in listOf("directorySync", "response")) {
      val root = freshRoot
      var active = false
      val writer = makeStore(root) { reached ->
        if (active && reached == phase) { active = false; throw StateFailure("STORAGE_FAILED") }
      }
      writer.open(); active = true
      assertThrows(StateFailure::class.java) { writer.commit("0") { it } }
      assertEquals("1", currentRevision(root))
      writer.commit("1") { it.getJSONObject("options").put("maxImageStorageBytes", 123); it }
      assertEquals("2", currentRevision(root))
      assertEquals(123L, makeStore(root).open().getJSONObject("options").getLong("maxImageStorageBytes"))
    }
  }

  @Test fun pendingRemainsReadableWithoutSessionKey() {
    val root = freshRoot
    val writer = makeStore(root)
    writer.open()
    writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    val id = writer.open().getJSONObject("session").getString("sessionKeyId")
    writer.commit("1") { state ->
      state.getJSONArray("pending").put(org.json.JSONObject()
        .put("deliveryId", "wa-delivery:v1:" + "a".repeat(32)).put("accountId", "123@lid")
        .put("createdRevision", "2").put("createdOrdinal", 0).put("source", "live")
        .put("identityState", "pendingLid")
        .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}").put("items", org.json.JSONArray())))
      state
    }
    val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    keyStore.deleteEntry("yoyos.whatsapp.test.${root.name.removePrefix("state-test-").replace("-", "")}.key.$id")
    val recovered = makeStore(root)
    assertEquals(1, recovered.open().getJSONArray("pending").length())
    assertEquals(false, recovered.canRestoreSession())
  }

  @Test fun pendingFormatAndIdentitySurviveRestartAndRejectIncoherence() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    val id = "wa-message:v1:" + android.util.Base64.encodeToString(
      "[\"123@lid\",\"456@lid\",\"ABC\"]".toByteArray(),
      android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
    val message = org.json.JSONObject().put("id", id).put("accountId", "123@lid")
      .put("whatsappMessageId", "ABC").put("chatId", "456@lid")
      .put("direction", "incoming").put("timestamp", 123456789L)
      .put("image", org.json.JSONObject().put("reference", org.json.JSONObject()
        .put("messageId", id).put("downloadReference", "opaque")))
    fun pending() = org.json.JSONObject().put("deliveryId", "wa-delivery:v1:" + "a".repeat(32))
      .put("accountId", "123@lid").put("createdRevision", "1").put("createdOrdinal", 0)
      .put("source", "live").put("identityState", "resolved").put("message", org.json.JSONObject(message.toString()))
      .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}")
        .put("items", org.json.JSONArray().put(org.json.JSONObject().put("format", "v2")
          .put("plaintextBase64", "AQ==").put("ciphertextHashBase64", android.util.Base64.encodeToString(ByteArray(32), android.util.Base64.NO_WRAP)))))
    store.commit("0") { it.put("pending", org.json.JSONArray().put(pending()))
      .put("androidService", org.json.JSONObject().put("receiveRequested", false).put("accountId", "123@lid")) }
    val recovered = makeStore(root).open()
    assertEquals(id, recovered.getJSONArray("pending").getJSONObject(0).getJSONObject("message").getString("id"))
    assertEquals("123@lid", recovered.getJSONObject("androidService").getString("accountId"))
    for (bad in listOf<(org.json.JSONObject) -> Unit>(
      { it.getJSONObject("message").put("chatId", "789@lid") },
      { it.getJSONObject("message").put("chatId", 456) },
      { it.getJSONObject("message").getJSONObject("image").getJSONObject("reference").put("downloadReference", 123) },
      { it.put("identityState", "pendingLid") },
      { it.put("createdOrdinal", 4294967296L) },
      { it.put("createdRevision", "01") },
      { it.getJSONObject("recovery").getJSONArray("items").getJSONObject(0).put("ciphertextHashBase64", "AQ==") },
      { it.getJSONObject("recovery").put("messageInfoJson", org.json.JSONObject()) },
      { it.getJSONObject("recovery").getJSONArray("items").getJSONObject(0).put("plaintextBase64", 1234) },
      { it.getJSONObject("recovery").getJSONArray("items").getJSONObject(0).put("plaintextBase64", "AQ") },
      { it.getJSONObject("recovery").getJSONArray("items").getJSONObject(0).put("plaintextBase64", "AR==") },
      { it.getJSONObject("recovery").getJSONArray("items").getJSONObject(0).put("format", "history") },
    )) {
      assertThrows(Exception::class.java) { store.commit("1") { it.put("pending", org.json.JSONArray().put(pending().also(bad))) } }
      assertEquals("1", currentRevision(root))
    }
    assertThrows(StateFailure::class.java) {
      store.commit("1") { it.put("pending", org.json.JSONArray().put(pending())
        .put(pending().put("deliveryId", "wa-delivery:v1:" + "b".repeat(32)))) }
    }
  }

  @Test fun interruptedRetirementCompletesBeforeAnotherSession() {
    for (phase in listOf("retiredPublished", "deleteSessionKey", "keyDeleted")) {
      val root = freshRoot
      var active = false
      val writer = makeStore(root) { if (active && it == phase) throw StateFailure("STORAGE_FAILED") }
      writer.open()
      writer.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
      active = true
      assertThrows(StateFailure::class.java) { writer.endSession() }
      val recovered = makeStore(root)
      val state = recovered.open()
      assertEquals(org.json.JSONObject.NULL, state.get("session"))
      assertEquals(0, state.getJSONArray("sessionKeysToDelete").length())
      recovered.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    }
  }

  @Test fun realFilesystemFailureCannotReplacePublishedState() {
    val root = freshRoot
    val writer = makeStore(root)
    writer.open()
    val next = File(directory(root), "state.next")
    assertEquals(true, next.mkdir())
    File(next, "occupied").writeText("x")
    assertThrows(StateFailure::class.java) { writer.commit("0") { it } }
    assertEquals("0", currentRevision(root))
  }

  @Test fun staleRevisionDoesNotReplacePublishedState() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    val old = currentRevision(root)
    store.commit(old) { it }
    assertThrows(StateFailure::class.java) { store.commit(old) { it } }
    makeStore(root).open()
  }

  @Test fun revisionsAndAccountIdsRequireCanonicalForms() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    for (revision in listOf("", "00", "01", "-1", "+1", "1.0", "18446744073709551616", "999999999999999999999999")) {
      assertThrows(StateFailure::class.java) { store.commit(revision) { it } }
    }
    for (account in listOf("", "123@s.whatsapp.net", "123:1@lid", "abc@lid", "123@lid/other")) {
      assertThrows(StateFailure::class.java) { store.beginSession(account, "{}".toByteArray()) }
    }
    assertEquals("0", currentRevision(root))
  }

  @Test fun exhaustedRevisionCannotCreateAProvisionalKey() {
    val root = freshRoot
    val initial = makeStore(root).open()
    val directory = directory(root)
    val original = File(directory, "state.bin").readBytes()
    val headerLength = java.nio.ByteBuffer.wrap(original, 8, 4).int
    val header = org.json.JSONObject(String(original, 12, headerLength, Charsets.UTF_8))
    val maximum = "18446744073709551615"
    header.put("revision", maximum)
    val namespace = root.name.removePrefix("state-test-").replace("-", "")
    val keys = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val recordKey = keys.getKey("yoyos.whatsapp.test.$namespace.creation-key", null) as javax.crypto.SecretKey
    val recordFile = File(directory, "creation.bin")
    val recordBytes = recordFile.readBytes()
    val opener = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    opener.init(javax.crypto.Cipher.DECRYPT_MODE, recordKey, javax.crypto.spec.GCMParameterSpec(128, recordBytes.copyOfRange(0, 12)))
    val record = org.json.JSONObject(String(opener.doFinal(recordBytes, 12, recordBytes.size - 12), Charsets.UTF_8))
      .put("preparedRevision", maximum)
    val recordSealer = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    recordSealer.init(javax.crypto.Cipher.ENCRYPT_MODE, recordKey)
    java.io.FileOutputStream(recordFile).use {
      it.write(recordSealer.iv); it.write(recordSealer.doFinal(record.toString().toByteArray())); it.fd.sync()
    }
    val recoveryKey = keys.getKey("yoyos.whatsapp.test.$namespace.key.${header.getString("recoveryKeyId")}", null) as javax.crypto.SecretKey
    val headerBytes = header.toString().toByteArray()
    val plaintext = initial.toString().toByteArray()
    val sealer = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    sealer.init(javax.crypto.Cipher.ENCRYPT_MODE, recoveryKey)
    val prefix = java.nio.ByteBuffer.allocate(8 + 4 + headerBytes.size + 12 + 8)
      .put("YOYOWA01".toByteArray()).putInt(headerBytes.size).put(headerBytes).put(sealer.iv)
      .putLong(plaintext.size.toLong() + 16).array()
    sealer.updateAAD(prefix)
    java.io.FileOutputStream(File(directory, "state.bin")).use {
      it.write(prefix); it.write(sealer.doFinal(plaintext)); it.fd.sync()
    }
    fun aliases(): Set<String> {
      val result = mutableSetOf<String>()
      val values = keys.aliases()
      while (values.hasMoreElements()) result.add(values.nextElement())
      return result
    }
    val before = aliases()
    val restored = makeStore(root)
    assertEquals(0, restored.open().getJSONArray("pending").length())
    val failure = assertThrows(StateFailure::class.java) {
      restored.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    }
    assertEquals("STATE_INVALID", failure.code)
    assertEquals(before, aliases())
    assertEquals(maximum, currentRevision(root))
  }

  @Test fun oversizedSessionCannotPublishOrPruneState() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    assertThrows(StateFailure::class.java) { store.beginSession("123@lid", ByteArray(16 * 1024 * 1024 + 1)) }
    assertEquals("0", currentRevision(root))
    assertEquals(org.json.JSONObject.NULL, makeStore(root).open().get("session"))
    fun session(ciphertextSize: Int) = org.json.JSONObject().put("accountId", "1@lid")
      .put("sessionKeyId", "a".repeat(32)).put("sessionRevision", "1")
      .put("nonceBase64", "AAAAAAAAAAAAAAAA").put("ciphertextBase64", "A".repeat(ciphertextSize))
    val overhead = session(0).toString().toByteArray().size
    val exactSize = 16 * 1024 * 1024 - overhead
    assertEquals(0, exactSize % 4)
    assertEquals(16 * 1024 * 1024, session(exactSize).toString().toByteArray().size)
    val exactFailure = assertThrows(StateFailure::class.java) {
      store.commit("0") { it.put("session", session(exactSize)) }
    }
    assertEquals("SESSION_STATE_INVALID", exactFailure.code)
    val overFailure = assertThrows(StateFailure::class.java) {
      store.commit("0") { it.put("session", session(exactSize + 4)) }
    }
    assertEquals("SESSION_STORAGE_LIMIT_REACHED", overFailure.code)
    assertEquals("0", currentRevision(root))
  }

  @Test fun oversizedRestoredSessionStillAllowsPendingToDrain() {
    val root = freshRoot
    makeStore(root).open()
    val file = File(directory(root), "state.bin")
    val original = file.readBytes()
    val headerLength = java.nio.ByteBuffer.wrap(original, 8, 4).int
    val header = original.copyOfRange(12, 12 + headerLength)
    val recoveryId = org.json.JSONObject(String(header, Charsets.UTF_8)).getString("recoveryKeyId")
    val namespace = root.name.removePrefix("state-test-").replace("-", "")
    val key = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      .getKey("yoyos.whatsapp.test.$namespace.key.$recoveryId", null) as javax.crypto.SecretKey
    val session = org.json.JSONObject().put("accountId", "123@lid").put("sessionKeyId", "a".repeat(32))
      .put("sessionRevision", "0").put("nonceBase64", "AAAAAAAAAAAAAAAA")
      .put("ciphertextBase64", "A".repeat(16 * 1024 * 1024))
    val pending = org.json.JSONObject().put("deliveryId", "wa-delivery:v1:" + "c".repeat(32))
      .put("accountId", "123@lid").put("createdRevision", "0").put("createdOrdinal", 0)
      .put("source", "live").put("identityState", "pendingLid")
      .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}").put("items", org.json.JSONArray()))
    val state = org.json.JSONObject().put("session", session).put("pending", org.json.JSONArray().put(pending))
      .put("sessionKeysToDelete", org.json.JSONArray())
      .put("options", org.json.JSONObject().put("maxRecoveryBufferBytes", 10 * 1024 * 1024).put("maxImageStorageBytes", 50 * 1024 * 1024))
      .put("androidService", org.json.JSONObject.NULL)
    val plaintext = state.toString().toByteArray(Charsets.UTF_8)
    val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key)
    val prefix = java.nio.ByteBuffer.allocate(8 + 4 + headerLength + 12 + 8)
      .put("YOYOWA01".toByteArray()).putInt(headerLength).put(header).put(cipher.iv)
      .putLong(plaintext.size.toLong() + 16).array()
    cipher.updateAAD(prefix)
    java.io.FileOutputStream(file).use { it.write(prefix); it.write(cipher.doFinal(plaintext)); it.fd.sync() }
    val restored = makeStore(root)
    assertEquals(1, restored.open().getJSONArray("pending").length())
    assertFalse(restored.canRestoreSession())
    restored.commit("0") { it.put("pending", org.json.JSONArray()) }
    assertEquals(0, makeStore(root).open().getJSONArray("pending").length())
  }

  @Test fun concurrentStoreInstancesCannotOverwriteAnOlderSnapshot() {
    val root = freshRoot
    val first = makeStore(root)
    val second = makeStore(root)
    first.open(); second.open()
    first.commit("0") { it.getJSONObject("options").put("maxImageStorageBytes", 123); it }
    assertThrows(StateFailure::class.java) { second.commit("0") { it } }
    second.commit("1") { it.getJSONObject("options").put("maxRecoveryBufferBytes", 456); it }
    val recovered = makeStore(root).open().getJSONObject("options")
    assertEquals(123L, recovered.getLong("maxImageStorageBytes"))
    assertEquals(456L, recovered.getLong("maxRecoveryBufferBytes"))
  }

  @Test fun logoutCannotDiscardAPendingCommitFromAnotherWriter() {
    val root = freshRoot
    val first = makeStore(root)
    val second = makeStore(root)
    first.open()
    first.beginSession("123@lid", "{\"protocolSchemaVersion\":1,\"records\":[]}".toByteArray())
    second.open()
    val entered = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    val workers = java.util.concurrent.Executors.newFixedThreadPool(2)
    try {
      val insert = workers.submit {
        first.commit("1") { state ->
          entered.countDown()
          if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw StateFailure("STORAGE_FAILED")
          state.getJSONArray("pending").put(org.json.JSONObject()
            .put("deliveryId", "wa-delivery:v1:" + "b".repeat(32)).put("accountId", "123@lid")
            .put("createdRevision", "2").put("createdOrdinal", 0).put("source", "live")
            .put("identityState", "pendingLid")
            .put("recovery", org.json.JSONObject().put("messageInfoJson", "{}").put("items", org.json.JSONArray())))
          state
        }
      }
      assertEquals(true, entered.await(10, java.util.concurrent.TimeUnit.SECONDS))
      val logout = workers.submit { second.endSession() }
      release.countDown()
      insert.get(10, java.util.concurrent.TimeUnit.SECONDS)
      logout.get(10, java.util.concurrent.TimeUnit.SECONDS)
      val recovered = makeStore(root).open()
      assertEquals(1, recovered.getJSONArray("pending").length())
      assertEquals(org.json.JSONObject.NULL, recovered.get("session"))
    } finally {
      release.countDown()
      workers.shutdownNow()
    }
  }

  @Test fun corruptedPublicationDoesNotBecomeEmptyInstallation() {
    val root = freshRoot
    makeStore(root).open()
    val file = File(directory(root), "state.bin")
    val bytes = file.readBytes(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte(); file.writeBytes(bytes)
    assertThrows(Exception::class.java) { makeStore(root).open() }
  }

  @Test fun establishedStateNeverRegeneratesMissingFileOrKeys() {
    val missingFile = freshRoot
    makeStore(missingFile).open()
    File(directory(missingFile), "state.bin").delete()
    assertThrows(StateFailure::class.java) { makeStore(missingFile).open() }

    val missingRecoveryKey = freshRoot
    makeStore(missingRecoveryKey).open()
    val headerBytes = File(directory(missingRecoveryKey), "state.bin").readBytes()
    val headerSize = java.nio.ByteBuffer.wrap(headerBytes, 8, 4).int
    val id = org.json.JSONObject(String(headerBytes, 12, headerSize, Charsets.UTF_8)).getString("recoveryKeyId")
    val namespace = missingRecoveryKey.name.removePrefix("state-test-").replace("-", "")
    java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      .deleteEntry("yoyos.whatsapp.test.$namespace.key.$id")
    assertThrows(Exception::class.java) { makeStore(missingRecoveryKey).open() }

    val missingReadyMarker = freshRoot
    makeStore(missingReadyMarker).open()
    val bytes = File(directory(missingReadyMarker), "state.bin").readBytes()
    val size = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
    val storeId = org.json.JSONObject(String(bytes, 12, size, Charsets.UTF_8)).getString("storeId")
    val markerNamespace = missingReadyMarker.name.removePrefix("state-test-").replace("-", "")
    java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      .deleteEntry("yoyos.whatsapp.test.$markerNamespace.ready.$storeId")
    assertThrows(StateFailure::class.java) { makeStore(missingReadyMarker).open() }
  }

  @Test fun malformedEnvelopeNeverPromotesTemporaryOrCreatesEmptyState() {
    for (mutate in listOf<(ByteArray) -> ByteArray>(
      { it.copyOf().also { bytes -> bytes[0] = 0 } },
      { it.copyOf().also { bytes -> java.nio.ByteBuffer.wrap(bytes, 8, 4).putInt(4097) } },
      { it.copyOf().also { bytes -> java.nio.ByteBuffer.wrap(bytes, 8, 4).putInt(Int.MAX_VALUE) } },
      { it.copyOf().also { bytes ->
        val headerLength = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
        val header = String(bytes, 12, headerLength, Charsets.UTF_8)
        val position = header.indexOf("\"revision\":\"0\"") + "\"revision\":\"".length
        bytes[12 + position] = '1'.code.toByte()
      } },
      { it.copyOf().also { bytes ->
        val headerLength = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
        bytes[12 + headerLength] = (bytes[12 + headerLength].toInt() xor 1).toByte()
      } },
      { it.copyOf().also { bytes ->
        val headerLength = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
        java.nio.ByteBuffer.wrap(bytes, 12 + headerLength + 12, 8).putLong(Long.MAX_VALUE)
      } },
      { it.copyOf().also { bytes ->
        val headerLength = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
        java.nio.ByteBuffer.wrap(bytes, 12 + headerLength + 12, 8).putLong(15)
      } },
      { it.copyOfRange(0, it.size - 1) },
      { it + 0.toByte() },
      { it.copyOf().also { bytes -> bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte() } },
    )) {
      val root = freshRoot
      makeStore(root).open()
      val file = File(directory(root), "state.bin")
      file.writeBytes(mutate(file.readBytes()))
      assertThrows(Exception::class.java) { makeStore(root).open() }
      assertEquals(true, file.exists())
    }
    val oversized = freshRoot
    makeStore(oversized).open()
    java.io.RandomAccessFile(File(directory(oversized), "state.bin"), "rw").use {
      it.setLength(16L * 1024 * 1024 + 10L * 1024 * 1024 + 8245)
    }
    assertThrows(StateFailure::class.java) { makeStore(oversized).open() }
  }

  @Test fun invalidStateDoesNotAdvancePublishedRevision() {
    val root = freshRoot
    val store = makeStore(root)
    store.open()
    val invalid = listOf<(org.json.JSONObject) -> Unit>(
      { it.getJSONObject("options").put("maxRecoveryBufferBytes", 0) },
      { it.getJSONObject("options").put("maxRecoveryBufferBytes", 1.5) },
      { it.getJSONObject("options").put("maxRecoveryBufferBytes", "100") },
      { it.getJSONObject("options").put("maxRecoveryBufferBytes", 9007199254740992L) },
      { it.put("unexpected", true) },
      { it.put("androidService", org.json.JSONObject().put("receiveRequested", true).put("accountId", "123@lid")) },
      { it.getJSONArray("pending").put(org.json.JSONObject().put("deliveryId", "wrong")) },
    )
    for (mutate in invalid) {
      assertThrows(Exception::class.java) { store.commit("0") { next -> mutate(next); next } }
      assertEquals("0", currentRevision(root))
      makeStore(root).open()
    }
  }

  private fun currentRevision(root: File): String {
    val bytes = File(directory(root), "state.bin").readBytes()
    val length = java.nio.ByteBuffer.wrap(bytes, 8, 4).int
    return org.json.JSONObject(String(bytes, 12, length, Charsets.UTF_8)).getString("revision")
  }
}
