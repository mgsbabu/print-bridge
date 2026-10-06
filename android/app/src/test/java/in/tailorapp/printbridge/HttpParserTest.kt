package `in`.tailorapp.printbridge

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class HttpParserTest {
    private fun parse(raw: String) = HttpParser.read(ByteArrayInputStream(raw.toByteArray(Charsets.ISO_8859_1)))

    @Test fun `parses a POST with a body`() {
        val body = "{\"a\":1}"
        val r = parse("POST /print?x=1 HTTP/1.1\r\nHost: 127.0.0.1:7755\r\nX-Bridge-Token: t\r\nContent-Length: ${body.length}\r\n\r\n$body")
        assertEquals("POST", r.method)
        assertEquals("/print", r.path)
        assertEquals("t", r.header("X-Bridge-Token"))
        assertEquals("127.0.0.1:7755", r.header("host"))
        assertArrayEquals(body.toByteArray(), r.body)
    }

    @Test fun `parses a GET without a body`() {
        val r = parse("GET /health HTTP/1.1\r\nHost: localhost:7755\r\n\r\n")
        assertEquals("GET", r.method)
        assertEquals(0, r.body.size)
    }

    @Test fun `rejects chunked bodies`() {
        val e = assertThrows(HttpException::class.java) {
            parse("POST /print HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n")
        }
        assertEquals(411, e.status)
    }

    @Test fun `rejects an oversized body before reading it`() {
        val e = assertThrows(HttpException::class.java) {
            parse("POST /print HTTP/1.1\r\nContent-Length: ${HttpParser.MAX_BODY + 1}\r\n\r\n")
        }
        assertEquals(413, e.status)
    }

    @Test fun `rejects oversized headers`() {
        val e = assertThrows(HttpException::class.java) {
            parse("GET / HTTP/1.1\r\nX-Pad: ${"a".repeat(HttpParser.MAX_HEADERS)}\r\n\r\n")
        }
        assertEquals(431, e.status)
    }

    @Test fun `rejects truncated requests`() {
        assertEquals(400, assertThrows(HttpException::class.java) { parse("GET /health HTTP/1.1\r\nHost: x") }.status)
        assertEquals(400, assertThrows(HttpException::class.java) {
            parse("POST /print HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc")
        }.status)
    }

    @Test fun `rejects a bad request line`() {
        assertEquals(400, assertThrows(HttpException::class.java) { parse("NONSENSE\r\n\r\n") }.status)
    }

    @Test fun `serialises status, length and headers`() {
        val out = String(
            HttpParser.serialize(HttpResponse(401, org.json.JSONObject().put("error", "x"), mapOf("Vary" to "Origin"))),
            Charsets.ISO_8859_1,
        )
        assertTrue(out.startsWith("HTTP/1.1 401 Unauthorized\r\n"))
        assertTrue(out.contains("Vary: Origin\r\n"))
        assertTrue(out.contains("Content-Length: 13\r\n"))
        assertTrue(out.endsWith("\r\n\r\n{\"error\":\"x\"}"))
    }
}
