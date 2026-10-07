package `in`.tailorapp.printbridge

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URI
import java.net.URISyntaxException

/** What a pairing code carries; mirrors the desktop bridge's `PairRequest` (src/shared/protocol.ts). */
data class Pairing(
    val tenantId: Long,
    val orgUnitId: Long,
    val token: String,
    val tenantOrigin: String,
    val tenantOrigins: List<String>,
) {
    /** Primary first, de-duplicated; same contract as `allowedOrigins()` in src/shared/origins.ts. */
    fun allowedOrigins(): List<String> = (listOf(tenantOrigin) + tenantOrigins).distinct()
}

/** Where the router reads and writes the pairing. [BridgeStore] is the real one; tests use a fake. */
interface PairingSource {
    fun getPairing(): Pairing?
    fun setPairing(pairing: Pairing)
}

object PairingCodes {
    const val MIN_TOKEN_LENGTH = 32
    const val MAX_EXTRA_ORIGINS = 10

    /**
     * Validates the way the desktop zod schema does: token at least 32 chars, positive integer ids, origins that
     * parse as http(s) URLs, at most 10 extra origins. The message of the thrown [IllegalArgumentException] is
     * safe to show to the operator (it never contains the token).
     */
    fun fromJson(j: JSONObject): Pairing {
        val tenantId = positiveInt(j, "tenantId")
        val orgUnitId = positiveInt(j, "orgUnitId")
        val token = j.opt("token") as? String
        require(token != null) { "token is required" }
        require(token.length >= MIN_TOKEN_LENGTH) { "token is too short" }
        val origin = j.opt("tenantOrigin") as? String
        require(origin != null) { "tenantOrigin is required" }

        val extras = mutableListOf<String>()
        val raw = j.opt("tenantOrigins")
        if (raw != null && raw != JSONObject.NULL) {
            val arr = raw as? JSONArray
            require(arr != null) { "tenantOrigins must be a list" }
            require(arr.length() <= MAX_EXTRA_ORIGINS) { "too many tenantOrigins (max $MAX_EXTRA_ORIGINS)" }
            for (i in 0 until arr.length()) {
                val s = arr.opt(i) as? String
                require(s != null) { "tenantOrigins must contain only strings" }
                extras.add(s)
            }
        }
        (listOf(origin) + extras).forEach { require(isOrigin(it)) { "not a valid origin: $it" } }
        return Pairing(tenantId, orgUnitId, token, origin, extras)
    }

    /** The base64 JSON code the web app issues (the one the desktop pair window decodes). */
    fun fromCode(code: String): Pairing {
        val json = try {
            JSONObject(String(Base64Lenient.decode(code.trim()), Charsets.UTF_8))
        } catch (e: JSONException) {
            throw IllegalArgumentException("Not a valid pairing code")
        }
        return fromJson(json)
    }

    private fun positiveInt(j: JSONObject, key: String): Long {
        val v = j.opt(key)
        val d = (v as? Number)?.toDouble()
        require(v is Number && d != null && d % 1.0 == 0.0 && d > 0 && d < 9.0e15) {
            "$key must be a positive integer"
        }
        return v.toLong()
    }

    private fun isOrigin(s: String): Boolean = try {
        val u = URI(s)
        (u.scheme == "http" || u.scheme == "https") && !u.host.isNullOrEmpty()
    } catch (e: URISyntaxException) {
        false
    }
}
