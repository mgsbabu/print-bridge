package `in`.tailorapp.printbridge

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/** The real socket layer over loopback TCP, with the router on a fake USB layer. */
class BridgeHttpServerTest {
    private lateinit var server: BridgeHttpServer
    private lateinit var printers: FakePrinterPort
    private var port = 0

    @Before fun setUp() {
        port = ServerSocket(0).use { it.localPort }
        printers = FakePrinterPort(listOf(EPSON))
        server = BridgeHttpServer(BridgeRouter(FakePairings(PAIRING), printers, "9.9.9"), port)
        server.start()
    }

    @After fun tearDown() = server.stop()

    private fun exchange(raw: String): String =
        Socket(InetAddress.getByName("127.0.0.1"), port).use { s ->
            s.soTimeout = 5000
            s.getOutputStream().apply { write(raw.toByteArray(Charsets.ISO_8859_1)); flush() }
            String(s.getInputStream().readBytes(), Charsets.UTF_8)
        }

    private fun get(path: String, token: String? = TEST_TOKEN) = exchange(
        "GET $path HTTP/1.1\r\nHost: 127.0.0.1:7755\r\nOrigin: $ORIGIN\r\n" +
            (if (token != null) "X-Bridge-Token: $token\r\n" else "") + "\r\n",
    )

    @Test fun `serves health over a real socket`() {
        val res = get("/health")
        assertTrue(res, res.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(res.contains("Access-Control-Allow-Origin: $ORIGIN\r\n"))
        assertEquals("9.9.9", JSONObject(res.substringAfter("\r\n\r\n")).getString("version"))
    }

    @Test fun `no token is 401 with the JSON error shape`() {
        val res = get("/health", token = null)
        assertTrue(res, res.startsWith("HTTP/1.1 401 Unauthorized\r\n"))
        assertEquals("UNAUTHORIZED", JSONObject(res.substringAfter("\r\n\r\n")).getString("errorCode"))
    }

    @Test fun `prints a posted job end to end`() {
        val body = printBody(printer = "default", language = "ESC_POS", payload = b64(byteArrayOf(0x1B, 0x40)))
        val res = exchange(
            "POST /print HTTP/1.1\r\nHost: localhost:7755\r\nX-Bridge-Token: $TEST_TOKEN\r\n" +
                "Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n$body",
        )
        assertTrue(res, res.startsWith("HTTP/1.1 200 OK\r\n"))
        assertEquals(1, printers.writes.size)
    }

    @Test fun `a malformed request gets a JSON 4xx and the server keeps serving`() {
        val bad = exchange("POST /print HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n")
        assertTrue(bad, bad.startsWith("HTTP/1.1 411 "))
        assertTrue(get("/health").startsWith("HTTP/1.1 200 OK"))
    }

    @Test fun `a wrong Host header is refused even with a valid token`() {
        val res = exchange("GET /health HTTP/1.1\r\nHost: evil.example.com\r\nX-Bridge-Token: $TEST_TOKEN\r\n\r\n")
        assertTrue(res, res.startsWith("HTTP/1.1 403 Forbidden\r\n"))
    }

    @Test fun `stop releases the port`() {
        server.stop()
        ServerSocket(port, 1, InetAddress.getByName("127.0.0.1")).close() // would throw if still bound
    }
}
