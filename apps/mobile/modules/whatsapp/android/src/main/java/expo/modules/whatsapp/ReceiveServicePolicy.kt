package expo.modules.whatsapp

import android.content.pm.ServiceInfo

/** The durable `androidService` field of the container. It never records a connection state or a Go generation. */
internal data class ReceiveIntent(val receiveRequested: Boolean, val accountId: String?)

/** What the recreated service must do after reading one snapshot. */
internal sealed class RestoreDecision {
  data class Restore(val accountId: String) : RestoreDecision()
  data class Stop(val reason: StopReason, val retireIntent: Boolean) : RestoreDecision()
}

internal enum class StopReason { NO_INTENT, NO_SESSION, ACCOUNT_MISMATCH, SESSION_UNUSABLE, SESSION_REVOKED }

/**
 * Pure decisions of the Android receive service, kept free of Android types so they run as plain JVM
 * tests. Notification, channel and promotion constants live here so the manifest, the service and the
 * tests share one definition.
 */
internal object ReceiveServicePolicy {
  const val CHANNEL_ID = "whatsapp-connection"
  /** Reserved for this service; the app must not reuse it for another notification. */
  const val NOTIFICATION_ID = 7301
  const val ACTION_START = "expo.modules.whatsapp.action.START_RECEIVING"
  /**
   * Stops are delivered to the service itself, never with Context.stopService right after
   * startForegroundService: AOSP (ActiveServices.bringDownServiceLocked / "Bringing down service while
   * still waiting for start foreground") raises "Context.startForegroundService() did not then call
   * Service.startForeground()" when the service is brought down before it was promoted. The service
   * promotes in onStartCommand first and then calls stopSelfResult(startId).
   */
  const val ACTION_STOP = "expo.modules.whatsapp.action.STOP_RECEIVING"
  const val SERVICE_CLASS = "expo.modules.whatsapp.WhatsAppService"
  /** `FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING` exists from API 34; earlier versions receive no type. */
  private const val FIRST_TYPED_API = 34

  fun foregroundType(sdk: Int): Int? = if (sdk >= FIRST_TYPED_API) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else null

  /**
   * The single valid recreation: an explicit intent for the account that owns a usable, not revoked
   * stored session. Anything else retires the notification and stops; a stale or inconsistent intent is
   * also withdrawn so the system never recreates the service in a loop. No QR is ever started here.
   */
  fun decideRestore(intent: ReceiveIntent?, sessionAccountId: String?, sessionUsable: Boolean, revoked: Boolean): RestoreDecision = when {
    intent == null || !intent.receiveRequested -> RestoreDecision.Stop(StopReason.NO_INTENT, retireIntent = false)
    sessionAccountId == null -> RestoreDecision.Stop(StopReason.NO_SESSION, retireIntent = true)
    intent.accountId != sessionAccountId -> RestoreDecision.Stop(StopReason.ACCOUNT_MISMATCH, retireIntent = true)
    revoked -> RestoreDecision.Stop(StopReason.SESSION_REVOKED, retireIntent = true)
    !sessionUsable -> RestoreDecision.Stop(StopReason.SESSION_UNUSABLE, retireIntent = true)
    else -> RestoreDecision.Restore(sessionAccountId)
  }

  /** `connect()` may arm the intent only for a stored session; QR linking arms it together with the session. */
  fun mayArmIntent(sessionAccountId: String?, sessionUsable: Boolean, revoked: Boolean): Boolean =
    sessionAccountId != null && sessionUsable && !revoked

  /** Local failures that need explicit intervention: the intent is withdrawn instead of retried by START_STICKY. */
  fun isLocalFault(errorCode: String): Boolean =
    errorCode == "SESSION_STORAGE_FAILED" || errorCode == "SESSION_STORAGE_LIMIT_REACHED" || errorCode == "SESSION_STATE_INVALID"

  /** What a connection event means for the service. */
  enum class EventEffect { NONE, CHECK_REQUEST, END }

  /**
   * Errors Go publishes without ever changing `requested` (`Controller.Notify`): content kept while an identity
   * is unknown, a refused history batch, a capacity pause. They can arrive with no request at all (WA-12 s1:
   * `IDENTITY_UNAVAILABLE` when `initialize()` opens the session without `connect()`), so they never withdraw
   * the intent. Every other code can end a request (`CONNECTION_FAILED`, and `FailLocal` codes such as
   * `CONSUMER_UNAVAILABLE`/`NATIVE_CALL_FAILED`, which end it with only an error when the state was already
   * `disconnected` in a capacity pause), so it is settled with Go's `requestActive` (WA-14 review M1).
   */
  val INFORMATIONAL_ERRORS: Set<String> = setOf("RECOVERY_BUFFER_FULL", "HISTORY_LIMIT_REACHED", "IDENTITY_UNAVAILABLE")

  /**
   * `disconnected` is ambiguous: Go publishes it for an ended request (unpaired failure, nothing left to
   * retry) and also for a RECOVERY_BUFFER_FULL pause that resumes by itself with the request still held.
   * Only `sessionExpired` is final by itself; `disconnected` and non-informational errors must be settled with
   * Go's own `requestActive` before the intent is withdrawn.
   */
  fun eventEffect(event: String, state: String?, errorCode: String? = null): EventEffect = when {
    event == "connectionChanged" && state == "sessionExpired" -> EventEffect.END
    event == "connectionChanged" && state == "disconnected" -> EventEffect.CHECK_REQUEST
    // A rebuild that fails after a capacity pause ends the request with only an error: the state was already
    // `disconnected`, so no new state event follows. The intent is withdrawn if and only if the request ended.
    event == "error" && !INFORMATIONAL_ERRORS.contains(errorCode) -> EventEffect.CHECK_REQUEST
    else -> EventEffect.NONE
  }

  /** Withdraw for a `disconnected` only when Go no longer holds the request (it is not a pause or retry). */
  fun endsRequest(requestActive: Boolean): Boolean = !requestActive
}
