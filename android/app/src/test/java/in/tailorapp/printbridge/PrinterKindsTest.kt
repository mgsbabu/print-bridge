package `in`.tailorapp.printbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrinterKindsTest {
    @Test fun `portal names are stable zero-padded lowercase hex`() {
        assertEquals("USB printer 04b8:0e15", PrinterKinds.portalName(0x04b8, 0x0e15))
        assertEquals("USB printer 1203:0002", PrinterKinds.portalName(0x1203, 0x0002))
        assertEquals("USB printer 04b8:0e15", EPSON.portalName)
    }

    @Test fun `a device needs a printer or vendor interface and a bulk-OUT endpoint to be offered`() {
        assertTrue(EPSON.isPrinterLike)
        assertTrue(device(0x1203, 2, classes = listOf(255)).isPrinterLike)
        assertFalse(device(0x1203, 2, bulkOut = false).isPrinterLike)
        assertFalse(device(0x0781, 0x5567, classes = listOf(8)).isPrinterLike) // USB stick
    }

    @Test fun `languages follow the vendor, unknown stays TSPL`() {
        assertEquals("ESC_POS", EPSON.language)
        assertEquals("TSPL", TSC.language)
        assertEquals("ZPL", device(0x0a5f, 1).language)
        assertEquals("TSPL", device(0x1234, 1).language)
    }

    @Test fun `office inkjets are flagged but label printers are not`() {
        assertTrue(HP_DESKJET.likelyOfficePrinter)
        assertFalse(EPSON.likelyOfficePrinter)
        assertFalse(TSC.likelyOfficePrinter)
    }

    @Test fun `test payloads exist for raw languages only`() {
        assertNotNull(testPayloadFor("TSPL"))
        assertNotNull(testPayloadFor("ZPL"))
        assertNotNull(testPayloadFor("ESC_POS"))
        assertNull(testPayloadFor("PDF"))
        val tspl = String(testPayloadFor("TSPL")!!, Charsets.US_ASCII)
        assertTrue(tspl.contains("SIZE") && tspl.contains("PRINT")) // must pass the router's own TSPL check
        // ESC @ first, and no GS V cut for cutter-less printers like the TM-T82X.
        val receipt = testPayloadFor("ESC_POS")!!
        assertEquals(0x1B.toByte(), receipt[0])
        assertEquals(0x40.toByte(), receipt[1])
        assertFalse(receipt.toList().windowed(2).any { it[0] == 0x1D.toByte() && it[1] == 0x56.toByte() })
    }
}
