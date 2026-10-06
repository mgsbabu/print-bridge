package `in`.tailorapp.printbridge

import org.json.JSONArray
import org.json.JSONObject

const val TEST_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef"
const val ORIGIN = "https://web.fabklean.com"

class FakePairings(var stored: Pairing? = null, var failOnSet: Boolean = false) : PairingSource {
    override fun getPairing() = stored
    override fun setPairing(pairing: Pairing) {
        if (failOnSet) throw IllegalStateException("disk full")
        stored = pairing
    }
}

/** Records every write; can be told to fail the next ones. */
class FakePrinterPort(var devices: List<UsbDeviceInfo> = emptyList()) : PrinterPort {
    class Write(val vendorId: Int, val productId: Int, val bytes: ByteArray)

    val writes = mutableListOf<Write>()
    var failWith: UsbPrintException? = null

    override fun listDevices() = devices

    override fun write(vendorId: Int, productId: Int, bytes: ByteArray, deviceName: String?) {
        failWith?.let { throw it }
        writes.add(Write(vendorId, productId, bytes))
    }
}

fun device(
    vid: Int,
    pid: Int,
    classes: List<Int> = listOf(7),
    bulkOut: Boolean = true,
    permission: Boolean = true,
) = UsbDeviceInfo("/dev/bus/usb/001/%03d".format(pid), vid, pid, 0, classes, bulkOut, permission, null)

val EPSON = device(0x04b8, 0x0e15)
val HP_DESKJET = device(0x03f0, 0x0c17)
val TSC = device(0x1203, 0x0002)

val PAIRING = Pairing(1, 2, TEST_TOKEN, ORIGIN, emptyList())

fun request(
    method: String,
    path: String,
    body: String = "",
    token: String? = TEST_TOKEN,
    origin: String? = ORIGIN,
    host: String? = "127.0.0.1:7755",
    extra: Map<String, String> = emptyMap(),
): HttpRequest {
    val h = linkedMapOf<String, String>()
    if (host != null) h["host"] = host
    if (token != null) h["x-bridge-token"] = token
    if (origin != null) h["origin"] = origin
    h.putAll(extra)
    return HttpRequest(method, path, h, body.toByteArray(Charsets.UTF_8))
}

fun HttpResponse.json(): JSONObject = JSONObject(body.toString())
fun HttpResponse.array(): JSONArray = JSONArray(body.toString())

fun b64(s: String): String = java.util.Base64.getEncoder().encodeToString(s.toByteArray(Charsets.ISO_8859_1))
fun b64(b: ByteArray): String = java.util.Base64.getEncoder().encodeToString(b)

fun printBody(
    printer: String = "USB printer 1203:0002",
    language: String = "TSPL",
    payload: String = b64("SIZE 50 mm,30 mm\r\nCLS\r\nPRINT 1,1\r\n"),
    copies: Int = 1,
): String = JSONObject()
    .put("printerName", printer).put("language", language)
    .put("payloadBase64", payload).put("copies", copies).put("jobRef", 7)
    .toString()
