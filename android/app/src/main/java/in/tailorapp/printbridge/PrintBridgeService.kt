package `in`.tailorapp.printbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps [BridgeHttpServer] alive. Android kills ordinary background work, so the bridge runs as a foreground
 * service with a visible notification: the price of a localhost print agent on a phone-class OS.
 */
class PrintBridgeService : Service() {
    private var server: BridgeHttpServer? = null

    companion object {
        private const val TAG = "PrintBridgeService"
        private const val CHANNEL = "print_bridge"
        private const val NOTIFICATION_ID = 7755

        @Volatile var running = false
            private set

        /** Why the last start failed, for the UI. Null while running or never failed. */
        @Volatile var lastError: String? = null
            private set

        fun start(context: Context) {
            BridgeStore(context).wantRunning = true
            val intent = Intent(context, PrintBridgeService::class.java)
            // startForegroundService() only exists from API 26; before that a plain startService() is the way.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.applicationContext.startForegroundService(intent)
            } else {
                context.applicationContext.startService(intent)
            }
        }

        fun stop(context: Context) {
            BridgeStore(context).wantRunning = false
            context.stopService(Intent(context, PrintBridgeService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (server != null) return START_STICKY
        try {
            startInForeground()
            val store = BridgeStore(this)
            val router = BridgeRouter(store, AndroidUsbPrinterPort.get(this), BuildConfig.VERSION_NAME)
            val s = BridgeHttpServer(router)
            s.start()
            server = s
            running = true
            lastError = null
        } catch (e: SecurityException) {
            // Android 14+ refuses a connectedDevice foreground service until the app holds USB permission for
            // a device. The UI asks for it before starting; this is the boot / no-printer-attached path.
            lastError = "Android refused to start the service: grant USB permission to an attached printer first " +
                "(${e.message ?: "SecurityException"})"
            fail()
            return START_NOT_STICKY
        } catch (e: Exception) {
            // Port already taken, or any other start failure.
            lastError = e.message ?: e.javaClass.simpleName
            fail()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun fail() {
        Log.w(TAG, "bridge did not start: $lastError")
        running = false
        stopSelf()
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        running = false
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val builder: Notification.Builder
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Print Bridge", NotificationManager.IMPORTANCE_LOW),
            )
            builder = Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            builder = Notification.Builder(this)
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val n = builder
            .setSmallIcon(R.drawable.ic_stat_print)
            .setContentTitle("Print Bridge running")
            .setContentText("Labels and receipts from the web portal print to the USB printer")
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }
}
