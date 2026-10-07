package `in`.tailorapp.printbridge

/** 50x30 mm label with gap sensing: text, a Code 128 barcode and a QR code. */
val TEST_LABEL: String = listOf(
    "SIZE 50 mm,30 mm",
    "GAP 2 mm,0 mm",
    "CLS",
    "TEXT 20,15,\"3\",0,1,1,\"USB TEST OK\"",
    "BARCODE 20,55,\"128\",50,1,0,2,2,\"123456\"",
    "QRCODE 300,15,L,4,A,0,\"TEST\"",
    "PRINT 1,1",
).joinToString("\r\n", postfix = "\r\n")

/** ZPL self-test, the Android twin of buildZplSample() in src/main/test-print-sample.ts. */
val TEST_ZPL: String = listOf("^XA", "^CF0,30", "^FO20,20^FDBRIDGE OK^FS", "^XZ").joinToString("\n")

/**
 * ESC/POS: initialise, a few lines of text, feed. Deliberately no cut command: entry-level thermal printers such
 * as the Epson TM-T82X have no auto-cutter and GS V either no-ops or misbehaves on them (see the desktop sample).
 * 0x1B 0x40 is ESC @, 0x0A is a line feed.
 */
val TEST_RECEIPT: ByteArray =
    byteArrayOf(0x1B, 0x40) +
        "USB RECEIPT TEST OK".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x0A) +
        "1234567890".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x0A, 0x0A, 0x0A, 0x0A)

/** The payload /test-print sends for a printer that reports [language]; null for PDF (unsupported here). */
fun testPayloadFor(language: String): ByteArray? = when (language) {
    "TSPL" -> TEST_LABEL.toByteArray(Charsets.US_ASCII)
    "ZPL" -> TEST_ZPL.toByteArray(Charsets.US_ASCII)
    "ESC_POS" -> TEST_RECEIPT
    else -> null
}
