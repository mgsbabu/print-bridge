package `in`.tailorapp.printbridge

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.security.MessageDigest

/** Last few failures, surfaced on /health as `recentErrors`. Messages never contain label content. */
class ErrorLog(private val capacity: Int = 10, private val clock: () -> Long = System::currentTimeMillis) {
    private val items = ArrayDeque<JSONObject>()

    fun add(msg: String, code: String?) {
        synchronized(items) {
            items.addLast(JSONObject().put("ts", clock()).put("msg", msg).apply { if (code != null) put("code", code) })
            while (items.size > capacity) items.removeFirst()
        }
    }

    fun toJson(): JSONArray = synchronized(items) { JSONArray(items.toList()) }
}

/**
 * The wire protocol of src/main/server.ts, with no sockets and no Android types, so it runs under plain JUnit.
 *
 * Routes: POST /pair, GET /health, GET /printers, POST /print, POST /test-print. Everything but /pair needs the
 * paired X-Bridge-Token. CORS echoes only origins from the pairing, never a wildcard.
 *
 * Label and receipt bytes are decoded in memory, handed to [printers], and never logged or stored.
 */
class BridgeRouter(
    private val pairings: PairingSource,
    private val printers: PrinterPort,
    private val appVersion: String,
    private val clock: () -> Long = System::currentTimeMillis,
    val errors: ErrorLog = ErrorLog(),
) {
    private val startedAt = clock()

    companion object {
        const val PORT = 7755
        const val HOST = "127.0.0.1"

        /** DNS-rebinding guard: only requests addressed to loopback are ours. */
        val ALLOWED_HOSTS = setOf("$HOST:$PORT", "localhost:$PORT")
        private val LANGUAGES = setOf("PDF", "ZPL", "ESC_POS", "TSPL")
        private val TSPL_PRINT = Regex("\\bPRINT\\b", RegexOption.IGNORE_CASE)
        private val TSPL_SIZE = Regex("\\bSIZE\\b", RegexOption.IGNORE_CASE)
    }

    fun handle(req: HttpRequest): HttpResponse {
        val res = try {
            route(req)
        } catch (e: HttpException) {
            fail(e.status, e.code, e.message ?: "")
        } catch (e: Exception) {
            errors.add("request failed: ${e.javaClass.simpleName}", "INTERNAL")
            fail(500, "INTERNAL", "internal")
        }
        return withCors(req, res)
    }

    // -- CORS ---------------------------------------------------------------------------------------------

    /**
     * Added to every response, errors included: the web app reads a 401 as "online but not paired", and without
     * CORS headers on it the browser would show an opaque network failure instead.
     */
    private fun withCors(req: HttpRequest, res: HttpResponse): HttpResponse {
        val h = linkedMapOf<String, String>("Vary" to "Origin")
        // Chrome's Private Network Access: a public HTTPS page reaching loopback needs this on the preflight
        // response, whatever the origin, or the request is blocked before CORS is even looked at.
        if (req.header("access-control-request-private-network") == "true") {
            h["Access-Control-Allow-Private-Network"] = "true"
        }
        val origin = req.header("origin")
        if (origin != null) {
            val isPair = req.path == "/pair"
            // /pair answers any origin: the web app calls it before any allow-list exists.
            val allowed = isPair || pairings.getPairing()?.allowedOrigins()?.contains(origin) == true
            if (allowed) {
                h["Access-Control-Allow-Origin"] = origin
                if (req.method == "OPTIONS") {
                    h["Access-Control-Allow-Methods"] = if (isPair) "POST, OPTIONS" else "GET, POST, OPTIONS"
                    h["Access-Control-Allow-Headers"] = if (isPair) "Content-Type" else "Content-Type, X-Bridge-Token"
                    if (!isPair) h["Access-Control-Max-Age"] = "600"
                }
            }
        }
        return HttpResponse(res.status, res.body, h + res.headers)
    }

    // -- Routing ------------------------------------------------------------------------------------------

    private fun route(req: HttpRequest): HttpResponse {
        val host = req.header("host")?.lowercase()
        if (host == null || host !in ALLOWED_HOSTS) throw HttpException(403, "UNAUTHORIZED", "Bad Host header")

        if (req.method == "OPTIONS") return HttpResponse(204)
        if (req.method == "POST" && req.path == "/pair") return pair(req)

        val pairing = pairings.getPairing()
        val presented = req.header("x-bridge-token")
        if (pairing == null || presented == null || !MessageDigest.isEqual(presented.toByteArray(), pairing.token.toByteArray())) {
            throw HttpException(401, "UNAUTHORIZED", "Missing or invalid bridge token")
        }
        return when {
            req.method == "GET" && req.path == "/health" -> HttpResponse(200, health(pairing))
            req.method == "GET" && req.path == "/printers" -> HttpResponse(200, JSONArray(loadedPrinters().map { it.json }))
            req.method == "POST" && req.path == "/print" -> print(req)
            req.method == "POST" && req.path == "/test-print" -> testPrint(req)
            else -> throw HttpException(404, "BAD_PAYLOAD", "No such route")
        }
    }

    private fun pair(req: HttpRequest): HttpResponse {
        val pairing = try {
            PairingCodes.fromJson(JSONObject(String(req.body, Charsets.UTF_8)))
        } catch (e: IllegalArgumentException) {
            return fail(400, "BAD_PAYLOAD", e.message ?: "Invalid pair body")
        } catch (e: JSONException) {
            return fail(400, "BAD_PAYLOAD", "Invalid pair body")
        }
        return try {
            pairings.setPairing(pairing)
            HttpResponse(200, JSONObject().put("paired", true))
        } catch (e: Exception) {
            errors.add("could not persist pairing: ${e.javaClass.simpleName}", "INTERNAL")
            fail(500, "INTERNAL", "Failed to persist pairing")
        }
    }

    // -- Printers -----------------------------------------------------------------------------------------

    private class Loaded(val name: String, val vendorId: Int, val productId: Int, val language: String, val json: JSONObject)

    /**
     * Every attached printer-like USB device, nothing hidden: the portal picks one by name. The first is flagged
     * default, which is what "default" resolves to in /print.
     */
    private fun loadedPrinters(): List<Loaded> =
        printers.listDevices().filter { it.isPrinterLike }.mapIndexed { i, d ->
            Loaded(
                d.portalName, d.vendorId, d.productId, d.language,
                JSONObject().put("name", d.portalName).put("language", d.language)
                    .put("mediaWidthMm", JSONObject.NULL).put("mediaHeightMm", JSONObject.NULL)
                    .put("mediaKind", JSONObject.NULL).put("isDefault", i == 0).put("online", true),
            )
        }

    private fun health(p: Pairing): JSONObject = JSONObject()
        .put("version", appVersion).put("os", "android")
        .put("loadedPrinters", JSONArray(loadedPrinters().map { it.json }))
        .put("tenantId", p.tenantId).put("orgUnitId", p.orgUnitId)
        .put("uptimeSeconds", (clock() - startedAt) / 1000)
        .put("recentErrors", errors.toJson())

    // -- Printing -----------------------------------------------------------------------------------------

    private fun print(req: HttpRequest): HttpResponse {
        val j = try {
            JSONObject(String(req.body, Charsets.UTF_8))
        } catch (e: JSONException) {
            return printFailure(400, "Invalid print body", "BAD_PAYLOAD")
        }
        val name = (j.opt("printerName") as? String)?.takeIf { it.isNotEmpty() }
        val language = j.opt("language") as? String
        val b64 = (j.opt("payloadBase64") as? String)?.takeIf { it.isNotEmpty() }
        val copies = intOf(j.opt("copies"))
        val jobRef = intOf(j.opt("jobRef"))
        if (name == null || b64 == null || language == null || language !in LANGUAGES ||
            copies == null || copies !in 1..99 || jobRef == null || jobRef < 0
        ) {
            return printFailure(400, "Invalid print body", "BAD_PAYLOAD")
        }
        if (language == "PDF") {
            return printFailure(400, "PDF printing is not supported on Android", "BAD_PAYLOAD")
        }
        val bytes = Base64Lenient.decode(b64)
        if (language == "TSPL") {
            // Same cheap sanity check as src/main/dispatcher/tspl.ts: an obviously wrong stream fails fast
            // instead of feeding blank labels.
            val text = String(bytes, Charsets.ISO_8859_1)
            if (!TSPL_PRINT.containsMatchIn(text) || !TSPL_SIZE.containsMatchIn(text)) {
                return printFailure(400, "Payload does not look like TSPL (missing SIZE / PRINT command)", "BAD_PAYLOAD")
            }
        }
        val target = resolve(name)
            ?: return printFailure(502, "Printer $name not registered", "PRINTER_NOT_FOUND")
        return dispatch(target, bytes, copies)
    }

    private fun testPrint(req: HttpRequest): HttpResponse {
        val parsed = try {
            JSONObject(String(req.body, Charsets.UTF_8))
        } catch (e: JSONException) {
            null
        }
        val name = (parsed?.opt("printerName") as? String)?.takeIf { it.isNotEmpty() }
            ?: return printFailure(400, "Invalid test-print body", "BAD_PAYLOAD")
        val target = loadedPrinters().firstOrNull { it.name == name }
            ?: return printFailure(404, "Printer $name not registered", "PRINTER_NOT_FOUND")
        val payload = testPayloadFor(target.language)
            ?: return printFailure(400, "Test print is not supported for ${target.language} printers", "BAD_PAYLOAD")
        return dispatch(target, payload, 1)
    }

    private fun resolve(name: String): Loaded? {
        val list = loadedPrinters()
        return if (name == "default") list.firstOrNull() else list.firstOrNull { it.name == name }
    }

    private fun dispatch(target: Loaded, bytes: ByteArray, copies: Int): HttpResponse {
        return try {
            repeat(copies) { printers.write(target.vendorId, target.productId, bytes) }
            HttpResponse(200, JSONObject().put("dispatched", true).put("copiesAcknowledged", copies))
        } catch (e: UsbPrintException) {
            val code = when (e.code) {
                UsbPrintException.NO_DEVICE -> "PRINTER_NOT_FOUND"
                UsbPrintException.TIMEOUT, UsbPrintException.IO_ERROR, UsbPrintException.NO_ENDPOINT,
                UsbPrintException.PERMISSION_DENIED -> "PRINTER_OFFLINE"
                else -> "INTERNAL"
            }
            errors.add(e.message ?: e.code, code)
            printFailure(502, e.message ?: e.code, code)
        } catch (e: Exception) {
            errors.add("print failed: ${e.javaClass.simpleName}", "INTERNAL")
            printFailure(502, "USB write failed", "INTERNAL")
        }
    }

    // -- Helpers ------------------------------------------------------------------------------------------

    /** An integral JSON number as an Int; null for anything else (strings, 1.5, null). */
    private fun intOf(v: Any?): Int? {
        val d = (v as? Number)?.toDouble() ?: return null
        return if (d % 1.0 == 0.0 && d >= Int.MIN_VALUE && d <= Int.MAX_VALUE) d.toInt() else null
    }

    private fun fail(status: Int, code: String, message: String) =
        HttpResponse(status, JSONObject().put("error", message).put("errorCode", code))

    private fun printFailure(status: Int, message: String, code: String) = HttpResponse(
        status,
        JSONObject().put("dispatched", false).put("copiesAcknowledged", 0).put("error", message).put("errorCode", code),
    )
}
