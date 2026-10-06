package `in`.tailorapp.printbridge

import java.io.ByteArrayOutputStream
import java.io.InputStream

class HttpRequest(
    val method: String,
    val path: String,
    /** Header names are lower-cased. */
    val headers: Map<String, String>,
    val body: ByteArray = ByteArray(0),
) {
    fun header(name: String): String? = headers[name.lowercase()]
}

/** [body] is a JSONObject or JSONArray (GET /printers returns a bare array, like the desktop bridge), or null. */
class HttpResponse(
    val status: Int,
    val body: Any? = null,
    val headers: Map<String, String> = emptyMap(),
)

/** A request that cannot be parsed or must be refused before routing. */
class HttpException(val status: Int, val code: String, message: String) : Exception(message)

object HttpParser {
    const val MAX_BODY = 20 * 1024 * 1024
    const val MAX_HEADERS = 16 * 1024
    private const val CRLF_CRLF = 0x0D0A0D0A

    /** Reads one request off [input]. Throws [HttpException] for anything malformed or over the limits. */
    fun read(input: InputStream): HttpRequest {
        val head = ByteArrayOutputStream()
        var window = 0
        while (true) {
            val b = input.read()
            if (b < 0) throw HttpException(400, "BAD_PAYLOAD", "Truncated request")
            head.write(b)
            if (head.size() > MAX_HEADERS) throw HttpException(431, "BAD_PAYLOAD", "Headers too large")
            window = (window shl 8) or b
            if (window == CRLF_CRLF) break
        }
        val lines = head.toString(Charsets.ISO_8859_1.name()).split("\r\n").filter { it.isNotEmpty() }
        val parts = lines.firstOrNull()?.split(" ")
        if (parts == null || parts.size < 2) throw HttpException(400, "BAD_PAYLOAD", "Bad request line")
        val headers = lines.drop(1).mapNotNull {
            val i = it.indexOf(':')
            if (i <= 0) null else it.substring(0, i).trim().lowercase() to it.substring(i + 1).trim()
        }.toMap()
        if (headers["transfer-encoding"] != null) throw HttpException(411, "BAD_PAYLOAD", "Content-Length required")
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        if (len < 0 || len > MAX_BODY) throw HttpException(413, "BAD_PAYLOAD", "Body too large")
        val body = ByteArray(len)
        var read = 0
        while (read < len) {
            val n = input.read(body, read, len - read)
            if (n < 0) throw HttpException(400, "BAD_PAYLOAD", "Truncated body")
            read += n
        }
        return HttpRequest(parts[0].uppercase(), parts[1].substringBefore('?'), headers, body)
    }

    fun reason(status: Int): String = when (status) {
        200 -> "OK"
        204 -> "No Content"
        400 -> "Bad Request"
        401 -> "Unauthorized"
        403 -> "Forbidden"
        404 -> "Not Found"
        411 -> "Length Required"
        413 -> "Payload Too Large"
        431 -> "Request Header Fields Too Large"
        502 -> "Bad Gateway"
        else -> "Error"
    }

    /** Serialises [res] as an HTTP/1.1 response that closes the connection. */
    fun serialize(res: HttpResponse): ByteArray {
        val payload = (res.body?.toString() ?: "").toByteArray(Charsets.UTF_8)
        val sb = StringBuilder("HTTP/1.1 ${res.status} ${reason(res.status)}\r\n")
        if (res.body != null) sb.append("Content-Type: application/json; charset=utf-8\r\n")
        sb.append("Content-Length: ${payload.size}\r\nConnection: close\r\n")
        res.headers.forEach { (k, v) -> sb.append("$k: $v\r\n") }
        sb.append("\r\n")
        return sb.toString().toByteArray(Charsets.ISO_8859_1) + payload
    }
}
