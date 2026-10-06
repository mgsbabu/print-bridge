package `in`.tailorapp.printbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Brings the bridge back after a reboot, but only if the user had it on, autostart is enabled and it is paired. */
class BridgeBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val store = BridgeStore(context)
        if (!store.autostart || !store.wantRunning || store.getPairing() == null) return
        try {
            PrintBridgeService.start(context)
        } catch (e: Exception) {
            // Android may refuse a foreground start from boot; the app screen can start it by hand.
            Log.w("BridgeBootReceiver", "could not start bridge at boot: ${e.message}")
        }
    }
}
