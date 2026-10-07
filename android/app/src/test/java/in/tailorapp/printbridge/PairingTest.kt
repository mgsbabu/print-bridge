package `in`.tailorapp.printbridge

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
    private fun valid(): JSONObject = JSONObject()
        .put("tenantId", 1).put("orgUnitId", 2).put("token", TEST_TOKEN).put("tenantOrigin", ORIGIN)

    private fun reject(j: JSONObject, messagePart: String) {
        val e = assertThrows(IllegalArgumentException::class.java) { PairingCodes.fromJson(j) }
        assertTrue("message was: ${e.message}", e.message!!.contains(messagePart))
    }

    @Test fun `accepts a minimal valid pairing`() {
        val p = PairingCodes.fromJson(valid())
        assertEquals(1L, p.tenantId)
        assertEquals(2L, p.orgUnitId)
        assertEquals(listOf(ORIGIN), p.allowedOrigins())
    }

    @Test fun `token must be at least 32 characters`() {
        PairingCodes.fromJson(valid().put("token", "x".repeat(32)))
        reject(valid().put("token", "x".repeat(31)), "token")
        reject(valid().apply { remove("token") }, "token")
    }

    @Test fun `ids must be positive integers`() {
        reject(valid().put("tenantId", 0), "tenantId")
        reject(valid().put("tenantId", -3), "tenantId")
        reject(valid().put("tenantId", 1.5), "tenantId")
        reject(valid().put("tenantId", "1"), "tenantId")
        reject(valid().put("orgUnitId", 0), "orgUnitId")
        reject(valid().apply { remove("orgUnitId") }, "orgUnitId")
    }

    @Test fun `origins must be http or https urls with a host`() {
        reject(valid().put("tenantOrigin", "not a url"), "origin")
        reject(valid().put("tenantOrigin", "ftp://web.fabklean.com"), "origin")
        reject(valid().put("tenantOrigin", "https://"), "origin")
        reject(valid().apply { remove("tenantOrigin") }, "tenantOrigin")
        reject(valid().put("tenantOrigins", JSONArray().put("javascript:alert(1)")), "origin")
        PairingCodes.fromJson(valid().put("tenantOrigin", "http://localhost:3000"))
    }

    @Test fun `up to ten extra origins are allowed, eleven are not`() {
        fun origins(n: Int) = JSONArray().apply { repeat(n) { put("https://tenant$it.example.com") } }
        assertEquals(11, PairingCodes.fromJson(valid().put("tenantOrigins", origins(10))).allowedOrigins().size)
        reject(valid().put("tenantOrigins", origins(11)), "too many")
    }

    @Test fun `allowed origins are primary first and de-duplicated`() {
        val p = PairingCodes.fromJson(
            valid().put("tenantOrigins", JSONArray().put("https://b.example.com").put(ORIGIN).put("https://b.example.com")),
        )
        assertEquals(listOf(ORIGIN, "https://b.example.com"), p.allowedOrigins())
    }

    @Test fun `extra origins must be strings in a list`() {
        reject(valid().put("tenantOrigins", "https://b.example.com"), "list")
        reject(valid().put("tenantOrigins", JSONArray().put(5)), "strings")
    }

    @Test fun `decodes the base64 code the portal issues`() {
        val code = b64(valid().put("tenantOrigins", JSONArray().put("https://b.example.com")).toString())
        val p = PairingCodes.fromCode(code)
        assertEquals(listOf(ORIGIN, "https://b.example.com"), p.allowedOrigins())
        // Pasted codes arrive with stray whitespace and line breaks.
        assertEquals(p, PairingCodes.fromCode("  " + code.chunked(20).joinToString("\n") + "\n"))
    }

    @Test fun `garbage is not a pairing code`() {
        val e = assertThrows(IllegalArgumentException::class.java) { PairingCodes.fromCode("hello world") }
        assertEquals("Not a valid pairing code", e.message)
        assertThrows(IllegalArgumentException::class.java) { PairingCodes.fromCode("") }
        // Valid base64 of valid JSON that is not a pairing.
        assertThrows(IllegalArgumentException::class.java) { PairingCodes.fromCode(b64("{\"a\":1}")) }
    }

    @Test fun `error messages never contain the token`() {
        val e = assertThrows(IllegalArgumentException::class.java) {
            PairingCodes.fromJson(valid().put("tenantId", 0))
        }
        assertTrue(!e.message!!.contains(TEST_TOKEN))
    }
}
