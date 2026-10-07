package `in`.tailorapp.printbridge

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BridgeRouterTest {
    private lateinit var pairings: FakePairings
    private lateinit var port: FakePrinterPort
    private lateinit var router: BridgeRouter
    private var now = 1_000_000L

    @Before fun setUp() {
        pairings = FakePairings(PAIRING)
        port = FakePrinterPort(listOf(EPSON, HP_DESKJET, TSC))
        router = BridgeRouter(pairings, port, "1.2.3", clock = { now })
    }

    private fun send(r: HttpRequest) = router.handle(r)

    // -- Host check ---------------------------------------------------------------------------------------

    @Test fun `only loopback Host headers are served`() {
        assertEquals(200, send(request("GET", "/health", host = "127.0.0.1:7755")).status)
        assertEquals(200, send(request("GET", "/health", host = "localhost:7755")).status)
        assertEquals(200, send(request("GET", "/health", host = "LOCALHOST:7755")).status)
        for (bad in listOf("evil.example.com", "evil.example.com:7755", "127.0.0.1", "127.0.0.1:8000", "0.0.0.0:7755")) {
            val res = send(request("GET", "/health", host = bad))
            assertEquals("host $bad", 403, res.status)
        }
        assertEquals(403, send(request("GET", "/health", host = null)).status)
    }

    @Test fun `the host check also guards pair and preflights`() {
        assertEquals(403, send(request("POST", "/pair", "{}", token = null, host = "evil.example.com")).status)
        assertEquals(403, send(request("OPTIONS", "/print", token = null, host = "evil.example.com")).status)
    }

    // -- Auth ---------------------------------------------------------------------------------------------

    @Test fun `protected routes need the paired token`() {
        for ((m, p) in listOf("GET" to "/health", "GET" to "/printers", "POST" to "/print", "POST" to "/test-print")) {
            for (token in listOf(null, "", "wrong", TEST_TOKEN + "x", TEST_TOKEN.dropLast(1))) {
                val res = send(request(m, p, "{}", token = token))
                assertEquals("$m $p token=$token", 401, res.status)
                assertEquals("UNAUTHORIZED", res.json().getString("errorCode"))
            }
        }
    }

    @Test fun `an unpaired bridge rejects everything but pair`() {
        pairings.stored = null
        assertEquals(401, send(request("GET", "/health")).status)
        assertEquals(401, send(request("GET", "/printers", token = "anything")).status)
    }

    @Test fun `a 401 still carries CORS headers for a paired origin`() {
        val res = send(request("GET", "/health", token = null))
        assertEquals(401, res.status)
        assertEquals(ORIGIN, res.headers["Access-Control-Allow-Origin"])
    }

    @Test fun `unknown routes and wrong methods are 404 after auth`() {
        assertEquals(404, send(request("GET", "/nope")).status)
        assertEquals(404, send(request("GET", "/print")).status)
        assertEquals(404, send(request("POST", "/health")).status)
        assertEquals(401, send(request("GET", "/nope", token = null)).status)
    }

    // -- CORS ---------------------------------------------------------------------------------------------

    @Test fun `CORS echoes only paired origins, never a wildcard`() {
        pairings.stored = PAIRING.copy(tenantOrigins = listOf("https://second.example.com"))
        for (o in listOf(ORIGIN, "https://second.example.com")) {
            assertEquals(o, send(request("GET", "/health", origin = o)).headers["Access-Control-Allow-Origin"])
        }
        for (o in listOf("https://evil.example.com", "https://web.fabklean.com.evil.com", "http://web.fabklean.com", "null")) {
            assertNull("origin $o", send(request("GET", "/health", origin = o)).headers["Access-Control-Allow-Origin"])
        }
        assertFalse(send(request("GET", "/health")).headers.values.contains("*"))
        assertEquals("Origin", send(request("GET", "/health")).headers["Vary"])
    }

    @Test fun `an unpaired bridge allows no origin on protected routes`() {
        pairings.stored = null
        assertNull(send(request("OPTIONS", "/health")).headers["Access-Control-Allow-Origin"])
    }

    @Test fun `preflight for a protected route lists the token header`() {
        val res = send(request("OPTIONS", "/print", token = null, extra = mapOf(
            "access-control-request-method" to "POST",
            "access-control-request-headers" to "content-type,x-bridge-token",
        )))
        assertEquals(204, res.status)
        assertNull(res.body)
        assertEquals(ORIGIN, res.headers["Access-Control-Allow-Origin"])
        assertEquals("GET, POST, OPTIONS", res.headers["Access-Control-Allow-Methods"])
        assertEquals("Content-Type, X-Bridge-Token", res.headers["Access-Control-Allow-Headers"])
    }

    @Test fun `Private Network Access preflight is answered`() {
        val res = send(request("OPTIONS", "/printers", token = null, extra = mapOf("access-control-request-private-network" to "true")))
        assertEquals("true", res.headers["Access-Control-Allow-Private-Network"])
        // Without the request header the response must not advertise it.
        assertNull(send(request("OPTIONS", "/printers", token = null)).headers["Access-Control-Allow-Private-Network"])
    }

    @Test fun `pair answers any origin and only needs Content-Type`() {
        pairings.stored = null
        val res = send(request("OPTIONS", "/pair", token = null, origin = "https://anything.example.com"))
        assertEquals(204, res.status)
        assertEquals("https://anything.example.com", res.headers["Access-Control-Allow-Origin"])
        assertEquals("POST, OPTIONS", res.headers["Access-Control-Allow-Methods"])
        assertEquals("Content-Type", res.headers["Access-Control-Allow-Headers"])
    }

    // -- /pair --------------------------------------------------------------------------------------------

    private fun pairJson(tenantId: Any = 5, token: String = TEST_TOKEN) = JSONObject()
        .put("tenantId", tenantId).put("orgUnitId", 6).put("token", token)
        .put("tenantOrigin", "https://tenant.example.com").toString()

    @Test fun `pair stores a valid pairing without a token`() {
        pairings.stored = null
        val res = send(request("POST", "/pair", pairJson(), token = null, origin = "https://tenant.example.com"))
        assertEquals(200, res.status)
        assertTrue(res.json().getBoolean("paired"))
        assertEquals(5L, pairings.stored!!.tenantId)
        assertEquals("https://tenant.example.com", res.headers["Access-Control-Allow-Origin"])
    }

    @Test fun `pair rejects invalid bodies with BAD_PAYLOAD and stores nothing`() {
        pairings.stored = null
        for (body in listOf(pairJson(tenantId = 0), pairJson(token = "short"), "not json", "{}", "[]")) {
            val res = send(request("POST", "/pair", body, token = null))
            assertEquals(body, 400, res.status)
            assertEquals("BAD_PAYLOAD", res.json().getString("errorCode"))
        }
        assertNull(pairings.stored)
    }

    @Test fun `pair reports a storage failure as INTERNAL`() {
        pairings.failOnSet = true
        val res = send(request("POST", "/pair", pairJson(), token = null))
        assertEquals(500, res.status)
        assertEquals("INTERNAL", res.json().getString("errorCode"))
    }

    // -- /health and /printers ----------------------------------------------------------------------------

    @Test fun `health reports version, os, pairing and uptime`() {
        now += 125_000
        val j = send(request("GET", "/health")).json()
        assertEquals("1.2.3", j.getString("version"))
        assertEquals("android", j.getString("os"))
        assertEquals(1, j.getInt("tenantId"))
        assertEquals(2, j.getInt("orgUnitId"))
        assertEquals(125, j.getInt("uptimeSeconds"))
        assertEquals(3, j.getJSONArray("loadedPrinters").length())
        assertEquals(0, j.getJSONArray("recentErrors").length())
    }

    @Test fun `printers is a bare array listing every printer-like device by stable name`() {
        val arr = send(request("GET", "/printers")).array()
        val names = (0 until arr.length()).map { arr.getJSONObject(it).getString("name") }
        // The inkjet is listed too: nothing is hidden, the portal picks by name.
        assertEquals(listOf("USB printer 04b8:0e15", "USB printer 03f0:0c17", "USB printer 1203:0002"), names)
        val first = arr.getJSONObject(0)
        assertEquals("ESC_POS", first.getString("language"))
        assertTrue(first.getBoolean("isDefault"))
        assertTrue(first.isNull("mediaWidthMm"))
        assertTrue(first.getBoolean("online"))
        assertFalse(arr.getJSONObject(1).getBoolean("isDefault"))
    }

    @Test fun `devices that are not printers are not offered`() {
        port.devices = listOf(device(0x0781, 0x5567, classes = listOf(8)), device(0x1203, 2, bulkOut = false), TSC)
        assertEquals(1, send(request("GET", "/printers")).array().length())
    }

    // -- /print -------------------------------------------------------------------------------------------

    @Test fun `a TSPL job is written once to the named device`() {
        val tspl = "SIZE 50 mm,30 mm\r\nCLS\r\nPRINT 1,1\r\n"
        val res = send(request("POST", "/print", printBody(payload = b64(tspl))))
        assertEquals(200, res.status)
        assertTrue(res.json().getBoolean("dispatched"))
        assertEquals(1, res.json().getInt("copiesAcknowledged"))
        assertEquals(1, port.writes.size)
        assertEquals(0x1203, port.writes[0].vendorId)
        assertEquals(0x0002, port.writes[0].productId)
        assertArrayEquals(tspl.toByteArray(Charsets.ISO_8859_1), port.writes[0].bytes)
    }

    @Test fun `copies repeat the write`() {
        val res = send(request("POST", "/print", printBody(copies = 3)))
        assertEquals(3, res.json().getInt("copiesAcknowledged"))
        assertEquals(3, port.writes.size)
    }

    @Test fun `default means the first listed printer`() {
        val res = send(request("POST", "/print", printBody(printer = "default", language = "ESC_POS", payload = b64(byteArrayOf(0x1B, 0x40)))))
        assertEquals(200, res.status)
        assertEquals(0x04b8, port.writes[0].vendorId)
    }

    @Test fun `the portal can target the receipt printer while the inkjet is attached`() {
        val res = send(request("POST", "/print", printBody(printer = "USB printer 04b8:0e15", language = "ESC_POS", payload = b64(byteArrayOf(0x1B, 0x40, 0x41)))))
        assertEquals(200, res.status)
        assertEquals(1, port.writes.size)
        assertEquals(0x04b8, port.writes[0].vendorId)
        assertEquals(0x0e15, port.writes[0].productId)
    }

    @Test fun `ZPL and ESC_POS are written as raw bytes`() {
        val zpl = "^XA^FDhi^FS^XZ"
        assertEquals(200, send(request("POST", "/print", printBody(language = "ZPL", payload = b64(zpl)))).status)
        assertArrayEquals(zpl.toByteArray(), port.writes.last().bytes)
        val raw = byteArrayOf(0x1B, 0x40, 0x00, 0xFF.toByte(), 0x0A)
        assertEquals(200, send(request("POST", "/print", printBody(language = "ESC_POS", payload = b64(raw)))).status)
        assertArrayEquals(raw, port.writes.last().bytes)
    }

    @Test fun `PDF is refused as BAD_PAYLOAD`() {
        val res = send(request("POST", "/print", printBody(language = "PDF", payload = b64("%PDF-1.4"))))
        assertEquals(400, res.status)
        assertFalse(res.json().getBoolean("dispatched"))
        assertEquals(0, res.json().getInt("copiesAcknowledged"))
        assertEquals("BAD_PAYLOAD", res.json().getString("errorCode"))
        assertTrue(res.json().getString("error").contains("not supported on Android"))
        assertTrue(port.writes.isEmpty())
    }

    @Test fun `a TSPL payload needs SIZE and PRINT`() {
        for (bad in listOf("CLS\r\nPRINT 1,1", "SIZE 50 mm,30 mm\r\nCLS", "hello", "BLUESIZE PRINTER")) {
            val res = send(request("POST", "/print", printBody(payload = b64(bad))))
            assertEquals(bad, 400, res.status)
            assertEquals("BAD_PAYLOAD", res.json().getString("errorCode"))
        }
        // Case-insensitive, like the desktop check.
        assertEquals(200, send(request("POST", "/print", printBody(payload = b64("size 1,1\nprint 1")))).status)
        assertEquals(1, port.writes.size)
    }

    @Test fun `bad print bodies are BAD_PAYLOAD with the failure shape`() {
        val good = JSONObject(printBody())
        val bodies = listOf(
            "not json",
            "{}",
            JSONObject(good.toString()).apply { remove("printerName") }.toString(),
            JSONObject(good.toString()).put("printerName", "").toString(),
            JSONObject(good.toString()).put("language", "RTF").toString(),
            JSONObject(good.toString()).put("payloadBase64", "").toString(),
            JSONObject(good.toString()).put("copies", 0).toString(),
            JSONObject(good.toString()).put("copies", 100).toString(),
            JSONObject(good.toString()).put("copies", 1.5).toString(),
            JSONObject(good.toString()).put("copies", "2").toString(),
            JSONObject(good.toString()).put("jobRef", -1).toString(),
            JSONObject(good.toString()).apply { remove("jobRef") }.toString(),
        )
        for (b in bodies) {
            val res = send(request("POST", "/print", b))
            assertEquals(b, 400, res.status)
            val j = res.json()
            assertFalse(j.getBoolean("dispatched"))
            assertEquals(0, j.getInt("copiesAcknowledged"))
            assertEquals("BAD_PAYLOAD", j.getString("errorCode"))
        }
        assertTrue(port.writes.isEmpty())
    }

    @Test fun `an unknown printer name is PRINTER_NOT_FOUND`() {
        val res = send(request("POST", "/print", printBody(printer = "USB printer dead:beef")))
        assertEquals(502, res.status)
        assertEquals("PRINTER_NOT_FOUND", res.json().getString("errorCode"))
        assertFalse(res.json().getBoolean("dispatched"))
    }

    @Test fun `default with nothing attached is PRINTER_NOT_FOUND`() {
        port.devices = emptyList()
        val res = send(request("POST", "/print", printBody(printer = "default")))
        assertEquals("PRINTER_NOT_FOUND", res.json().getString("errorCode"))
    }

    @Test fun `USB failures map onto protocol error codes`() {
        val cases = mapOf(
            UsbPrintException.NO_DEVICE to "PRINTER_NOT_FOUND",
            UsbPrintException.TIMEOUT to "PRINTER_OFFLINE",
            UsbPrintException.IO_ERROR to "PRINTER_OFFLINE",
            UsbPrintException.NO_ENDPOINT to "PRINTER_OFFLINE",
            UsbPrintException.PERMISSION_DENIED to "PRINTER_OFFLINE",
            UsbPrintException.NO_USB_HOST to "INTERNAL",
            "SOMETHING_ELSE" to "INTERNAL",
        )
        for ((usbCode, expected) in cases) {
            port.failWith = UsbPrintException(usbCode, "boom $usbCode")
            val res = send(request("POST", "/print", printBody()))
            assertEquals(usbCode, 502, res.status)
            assertEquals(usbCode, expected, res.json().getString("errorCode"))
            assertEquals(0, res.json().getInt("copiesAcknowledged"))
            assertFalse(res.json().getBoolean("dispatched"))
        }
    }

    @Test fun `an unexpected exception is INTERNAL`() {
        port.devices = listOf(TSC)
        val broken = object : PrinterPort {
            override fun listDevices() = listOf(TSC)
            override fun write(vendorId: Int, productId: Int, bytes: ByteArray, deviceName: String?) {
                throw RuntimeException("secret detail")
            }
        }
        val res = BridgeRouter(pairings, broken, "x").handle(request("POST", "/print", printBody()))
        assertEquals("INTERNAL", res.json().getString("errorCode"))
        assertFalse(res.json().getString("error").contains("secret"))
    }

    @Test fun `failures appear in health recentErrors without payload content`() {
        port.failWith = UsbPrintException(UsbPrintException.TIMEOUT, "Printer did not accept data")
        val payload = "SIZE 1,1\nPRINT 1\nSUPERSECRETCUSTOMERNAME"
        send(request("POST", "/print", printBody(payload = b64(payload))))
        val errs = send(request("GET", "/health")).json().getJSONArray("recentErrors")
        assertEquals(1, errs.length())
        assertEquals("PRINTER_OFFLINE", errs.getJSONObject(0).getString("code"))
        assertFalse(errs.toString().contains("SUPERSECRET"))
        assertFalse(errs.toString().contains(b64(payload)))
    }

    @Test fun `recentErrors keeps only the last ten`() {
        port.failWith = UsbPrintException(UsbPrintException.TIMEOUT, "x")
        repeat(15) { send(request("POST", "/print", printBody())) }
        assertEquals(10, send(request("GET", "/health")).json().getJSONArray("recentErrors").length())
    }

    // -- /test-print --------------------------------------------------------------------------------------

    @Test fun `test-print sends a TSPL label to a TSPL printer`() {
        val res = send(request("POST", "/test-print", "{\"printerName\":\"USB printer 1203:0002\"}"))
        assertEquals(200, res.status)
        assertEquals(1, res.json().getInt("copiesAcknowledged"))
        val sent = String(port.writes.single().bytes, Charsets.US_ASCII)
        assertTrue(sent.contains("SIZE") && sent.contains("PRINT"))
    }

    @Test fun `test-print sends ESC_POS to the Epson, not a label`() {
        val res = send(request("POST", "/test-print", "{\"printerName\":\"USB printer 04b8:0e15\"}"))
        assertEquals(200, res.status)
        val w = port.writes.single()
        assertEquals(0x04b8, w.vendorId)
        assertEquals(0x1B.toByte(), w.bytes[0])
        assertFalse(String(w.bytes, Charsets.ISO_8859_1).contains("SIZE"))
    }

    @Test fun `test-print for an unregistered printer is a 404`() {
        val res = send(request("POST", "/test-print", "{\"printerName\":\"USB printer dead:beef\"}"))
        assertEquals(404, res.status)
        assertEquals("PRINTER_NOT_FOUND", res.json().getString("errorCode"))
        assertTrue(port.writes.isEmpty())
    }

    @Test fun `test-print validates its body`() {
        for (b in listOf("", "{}", "{\"printerName\":\"\"}", "nope")) {
            val res = send(request("POST", "/test-print", b))
            assertEquals(b, 400, res.status)
            assertEquals("BAD_PAYLOAD", res.json().getString("errorCode"))
        }
    }

    @Test fun `test-print reports a write failure`() {
        port.failWith = UsbPrintException(UsbPrintException.TIMEOUT, "stuck")
        val res = send(request("POST", "/test-print", "{\"printerName\":\"USB printer 1203:0002\"}"))
        assertEquals(502, res.status)
        assertEquals("PRINTER_OFFLINE", res.json().getString("errorCode"))
    }

    // -- Sanity -------------------------------------------------------------------------------------------

    @Test fun `responses are JSON arrays or objects`() {
        assertTrue(send(request("GET", "/printers")).body is JSONArray)
        assertTrue(send(request("GET", "/health")).body is JSONObject)
    }
}
