package `in`.tailorapp.printbridge

import android.annotation.SuppressLint
import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Pairing and switches, in app-private SharedPreferences (allowBackup is off, so they are not copied off the
 * device). Holds no label or receipt content.
 */
class BridgeStore(context: Context) : PairingSource {
    private val prefs = context.applicationContext.getSharedPreferences("print_bridge", Context.MODE_PRIVATE)

    override fun getPairing(): Pairing? {
        val raw = prefs.getString("pairing", null) ?: return null
        return try {
            PairingCodes.fromJson(JSONObject(raw))
        } catch (e: JSONException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    @SuppressLint("ApplySharedPref")
    override fun setPairing(pairing: Pairing) {
        val o = JSONObject()
            .put("tenantId", pairing.tenantId).put("orgUnitId", pairing.orgUnitId).put("token", pairing.token)
            .put("tenantOrigin", pairing.tenantOrigin).put("tenantOrigins", JSONArray(pairing.tenantOrigins))
        // commit(), not apply(): the HTTP /pair route answers "paired" right after this returns.
        check(prefs.edit().putString("pairing", o.toString()).commit()) { "could not write pairing" }
    }

    @SuppressLint("ApplySharedPref") // synchronous on purpose, like setPairing()
    fun clearPairing() {
        prefs.edit().remove("pairing").commit()
    }

    /** Restart the bridge after a reboot (see [BridgeBootReceiver]). */
    var autostart: Boolean
        get() = prefs.getBoolean("autostart", true)
        set(v) = prefs.edit().putBoolean("autostart", v).apply()

    /** True while the user wants the bridge up; cleared by an explicit Stop so a reboot does not revive it. */
    var wantRunning: Boolean
        get() = prefs.getBoolean("wantRunning", false)
        set(v) = prefs.edit().putBoolean("wantRunning", v).apply()
}
