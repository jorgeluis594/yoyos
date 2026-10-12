package expo.modules.whatsapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import java.util.concurrent.Executors

/**
 * Keeps the single native WhatsApp client alive while no screen is. It owns no client: the shared
 * [ConnectionRuntime] does, so Expo adopts whatever this service restored.
 *
 * Order matters (docs: "Reinicio del servicio Android"): the generic notification is published and the
 * service promoted *before* Go or storage are touched, and every heavy step runs off the main thread.
 * The service neither schedules alarms nor listens for boot, and it saves nothing in [onDestroy].
 */
class WhatsAppService : Service() {
  private val worker = Executors.newSingleThreadExecutor { Thread(it, "whatsapp-service").also { thread -> thread.isDaemon = true } }
  private var promoted = false
  private var refused = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ConnectionRuntime.serviceActive = true
    promote()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ReceiveServicePolicy.ACTION_START) ConnectionRuntime.pendingStarts.updateAndGet { if (it > 0) it - 1 else 0 }
    if (!promote()) return START_NOT_STICKY
    // Promotion has happened, so stopping now cannot trigger "did not then call startForeground()".
    // stopSelfResult(startId) is a no-op when a newer start (a racing connect()) arrived meanwhile.
    if (intent?.action == ReceiveServicePolicy.ACTION_STOP) {
      stopSelfResult(startId)
      return START_NOT_STICKY
    }
    // ACTION_START comes from connect(), which prepares the client itself. A null intent is the
    // system's START_STICKY recreation: restore only a valid durable intent, with no JavaScript.
    if (intent?.action != ReceiveServicePolicy.ACTION_START) {
      worker.execute { if (!ConnectionRuntime.restoreFromService(applicationContext)) stopSelfResult(startId) }
    }
    return START_STICKY
  }

  /** Publishes the generic notification and enters the foreground. A refusal withdraws the intent once and stops. */
  private fun promote(): Boolean {
    if (promoted) return true
    if (refused) return false
    return try {
      ensureChannel()
      val notification = notification()
      val type = ReceiveServicePolicy.foregroundType(Build.VERSION.SDK_INT)
      if (type != null) startForeground(ReceiveServicePolicy.NOTIFICATION_ID, notification, type)
      else startForeground(ReceiveServicePolicy.NOTIFICATION_ID, notification)
      promoted = true
      true
    } catch (_: Exception) {
      // Not allowed or rejected: no loop and no alternative service type. Data and session stay.
      // This is an unrecoverable configuration error (invalid notification or type): the service never reached
      // the foreground, so AOSP may still report "did not then call startForeground()" for this start. A
      // background-start refusal does not get here; startForegroundService itself throws and connect() handles it.
      refused = true
      worker.execute { ConnectionRuntime.serviceRefused() }
      stopSelf()
      false
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(ReceiveServicePolicy.CHANNEL_ID, getString(R.string.whatsapp_connection_channel_name), NotificationManager.IMPORTANCE_LOW),
    )
  }

  /** Generic by design: no QR, account, credential or message, and no download or logout actions. */
  private fun notification(): Notification {
    // Explicit: the launcher activity's own component, so the immutable PendingIntent cannot be redirected.
    val component = packageManager.getLaunchIntentForPackage(packageName)?.component
    val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).apply { if (component != null) setComponent(component) else setPackage(packageName) }
    val open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, ReceiveServicePolicy.CHANNEL_ID) else Notification.Builder(this)
    return builder
      .setContentTitle(getString(R.string.whatsapp_connection_title))
      .setSmallIcon(R.drawable.whatsapp_connection_icon)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
  }

  override fun onDestroy() {
    // A newer connect() may already have requested a start; its flag must survive this instance's destruction.
    synchronized(ConnectionRuntime.serviceFlagLock) { if (ConnectionRuntime.pendingStarts.get() == 0) ConnectionRuntime.serviceActive = false }
    worker.shutdown() // no persistence here: a killed process never reaches this method
    super.onDestroy()
  }
}
