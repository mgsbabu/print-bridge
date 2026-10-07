package `in`.tailorapp.printbridge

import java.io.ByteArrayOutputStream

/**
 * Base64 decoder that behaves like Node's `Buffer.from(s, "base64")`, which the desktop bridge uses: whitespace
 * and other stray characters are skipped, padding is optional, and the URL-safe alphabet is accepted.
 *
 * It exists as pure Kotlin because `java.util.Base64` needs API 26 (minSdk here is 24) and `android.util.Base64`
 * cannot run in a JVM unit test.
 */
object Base64Lenient {
    private val table = IntArray(256) { -1 }.also { t ->
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".forEachIndexed { i, c -> t[c.code] = i }
        t['-'.code] = 62
        t['_'.code] = 63
    }

    fun decode(input: String): ByteArray {
        val out = ByteArrayOutputStream(input.length / 4 * 3 + 3)
        var buffer = 0
        var bits = 0
        for (ch in input) {
            if (ch == '=') break
            val v = if (ch.code < 256) table[ch.code] else -1
            if (v < 0) continue
            buffer = ((buffer shl 6) or v) and 0xFFFFFF
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buffer shr bits) and 0xFF)
            }
        }
        return out.toByteArray()
    }
}
