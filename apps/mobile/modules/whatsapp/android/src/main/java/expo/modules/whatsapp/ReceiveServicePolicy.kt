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

  /** Generic text: never a QR, account, credential or message. */
  const val NOTIFICATION_TITLE = "Conexión de WhatsApp activa"
}
