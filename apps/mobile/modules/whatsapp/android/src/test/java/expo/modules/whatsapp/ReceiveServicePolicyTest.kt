package expo.modules.whatsapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM tests for WA-12. Not executed in the task that wrote them: Gradle is out of scope there. */
class ReceiveServicePolicyTest {
  private val intent = ReceiveIntent(true, "5551")

  // IT-AND-02: no typed constant before API 34.
  @Test fun typedPromotionOnlyFromApi34() {
    assertNull(ReceiveServicePolicy.foregroundType(33))
    assertNull(ReceiveServicePolicy.foregroundType(24))
    assertEquals(0x200, ReceiveServicePolicy.foregroundType(34))
  }

  // IT-AND-07: a valid intent for the stored account restores exactly one generation.
  @Test fun validIntentRestores() {
    assertEquals(RestoreDecision.Restore("5551"), ReceiveServicePolicy.decideRestore(intent, "5551", true, false))
  }

  // IT-AND-07: without intent the service stops and there is nothing to retire.
  @Test fun missingIntentStopsWithoutWriting() {
    assertEquals(RestoreDecision.Stop(StopReason.NO_INTENT, false), ReceiveServicePolicy.decideRestore(null, "5551", true, false))
    assertEquals(RestoreDecision.Stop(StopReason.NO_INTENT, false), ReceiveServicePolicy.decideRestore(ReceiveIntent(false, null), "5551", true, false))
  }

  // IT-AND-08: absent, mismatching, unusable or revoked sessions never restore and withdraw the intent.
  @Test fun unusableSessionsNeverRestore() {
    assertEquals(RestoreDecision.Stop(StopReason.NO_SESSION, true), ReceiveServicePolicy.decideRestore(intent, null, true, false))
    assertEquals(RestoreDecision.Stop(StopReason.ACCOUNT_MISMATCH, true), ReceiveServicePolicy.decideRestore(intent, "9999", true, false))
    assertEquals(RestoreDecision.Stop(StopReason.SESSION_REVOKED, true), ReceiveServicePolicy.decideRestore(intent, "5551", true, true))
    assertEquals(RestoreDecision.Stop(StopReason.SESSION_UNUSABLE, true), ReceiveServicePolicy.decideRestore(intent, "5551", false, false))
  }

  @Test fun connectArmsOnlyForUsableStoredSession() {
    assertTrue(ReceiveServicePolicy.mayArmIntent("5551", true, false))
    assertFalse(ReceiveServicePolicy.mayArmIntent(null, true, false))
    assertFalse(ReceiveServicePolicy.mayArmIntent("5551", false, false))
    assertFalse(ReceiveServicePolicy.mayArmIntent("5551", true, true))
  }

  // IT-AND-03: stable, generic channel and reserved id.
  @Test fun notificationConstantsAreStableAndGeneric() {
    assertEquals("whatsapp-connection", ReceiveServicePolicy.CHANNEL_ID)
    assertEquals(7301, ReceiveServicePolicy.NOTIFICATION_ID)
    assertEquals("expo.modules.whatsapp.action.STOP_RECEIVING", ReceiveServicePolicy.ACTION_STOP)
  }

  // IT-AND-05 / IT-AND-09: local faults withdraw the intent; transient network and buffer pauses do not.
  @Test fun onlyLocalFaultsWithdrawTheIntent() {
    assertTrue(ReceiveServicePolicy.isLocalFault("SESSION_STORAGE_FAILED"))
    assertTrue(ReceiveServicePolicy.isLocalFault("SESSION_STATE_INVALID"))
    assertFalse(ReceiveServicePolicy.isLocalFault("CONNECTION_FAILED"))
    assertFalse(ReceiveServicePolicy.isLocalFault("RECOVERY_BUFFER_FULL"))
  }

  // WA-12 N1: every cause of `disconnected`, settled with Go's own requestActive.
  @Test fun disconnectedIsSettledWithRequestActive() {
    val effect = ReceiveServicePolicy.eventEffect("connectionChanged", "disconnected")
    assertEquals(ReceiveServicePolicy.EventEffect.CHECK_REQUEST, effect)
    // RECOVERY_BUFFER_FULL pause: Go keeps requested=true and resumes by itself.
    assertFalse(ReceiveServicePolicy.endsRequest(requestActive = true))
    // Unpaired failure without retry, Disconnect, local fault: requested=false.
    assertTrue(ReceiveServicePolicy.endsRequest(requestActive = false))
  }

  @Test fun otherEventsNeverEndTheRequestByThemselves() {
    assertEquals(ReceiveServicePolicy.EventEffect.END, ReceiveServicePolicy.eventEffect("connectionChanged", "sessionExpired"))
    for (state in listOf("connecting", "awaitingQr", "connected", "reconnecting")) {
      assertEquals(ReceiveServicePolicy.EventEffect.NONE, ReceiveServicePolicy.eventEffect("connectionChanged", state))
    }
    assertEquals(ReceiveServicePolicy.EventEffect.NONE, ReceiveServicePolicy.eventEffect("qr", null))
  }

  // WA-12 r1: errors are settled with requestActive: RECOVERY_BUFFER_FULL / informational errors keep the
  // request (true), a failed rebuild after a pause ends it with no further state event (false).
  @Test fun errorsAreSettledWithRequestActive() {
    assertEquals(ReceiveServicePolicy.EventEffect.CHECK_REQUEST, ReceiveServicePolicy.eventEffect("error", null))
    assertFalse(ReceiveServicePolicy.endsRequest(requestActive = true))  // RECOVERY_BUFFER_FULL, IDENTITY_UNAVAILABLE
    assertTrue(ReceiveServicePolicy.endsRequest(requestActive = false))  // CONNECTION_FAILED after a failed resume
  }
}
