package `in`.tailorapp.printbridge

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Random

class Base64LenientTest {
    @Test fun `matches java Base64 for every length and padding`() {
        val rnd = Random(42)
        for (n in 0..64) {
            val bytes = ByteArray(n).also { rnd.nextBytes(it) }
            val enc = java.util.Base64.getEncoder().encodeToString(bytes)
            assertArrayEquals("length $n", bytes, Base64Lenient.decode(enc))
        }
    }

    @Test fun `padding is optional`() {
        assertEquals("hello", String(Base64Lenient.decode("aGVsbG8"), Charsets.US_ASCII))
        assertEquals("hello", String(Base64Lenient.decode("aGVsbG8="), Charsets.US_ASCII))
    }

    @Test fun `whitespace and the url-safe alphabet are accepted like Node does`() {
        val bytes = byteArrayOf(0xFB.toByte(), 0xFF.toByte(), 0xFE.toByte())
        assertArrayEquals(bytes, Base64Lenient.decode("+//+"))
        assertArrayEquals(bytes, Base64Lenient.decode("-__-"))
        assertEquals("hello", String(Base64Lenient.decode("aGVs\r\nbG8="), Charsets.US_ASCII))
    }

    @Test fun `a large payload decodes`() {
        val bytes = ByteArray(5 * 1024 * 1024).also { Random(1).nextBytes(it) }
        assertArrayEquals(bytes, Base64Lenient.decode(java.util.Base64.getEncoder().encodeToString(bytes)))
    }
}
