package `in`.tailorapp.printbridge

/** Failure with a stable [code] the router maps onto the wire protocol's error codes. */
class UsbPrintException(val code: String, message: String) : Exception(message) {
    companion object {
        const val NO_USB_HOST = "NO_USB_HOST"
        const val NO_DEVICE = "NO_DEVICE"
        const val NO_ENDPOINT = "NO_ENDPOINT"
        const val PERMISSION_DENIED = "PERMISSION_DENIED"
        const val TIMEOUT = "TIMEOUT"
        const val IO_ERROR = "IO_ERROR"
    }
}

/** Plain description of one attached USB device. No Android types, so the router and its tests stay on the JVM. */
data class UsbDeviceInfo(
    val deviceName: String,
    val vendorId: Int,
    val productId: Int,
    val deviceClass: Int,
    val interfaceClasses: List<Int>,
    val hasBulkOut: Boolean,
    val hasPermission: Boolean,
    /** Only readable once USB permission is held (Android 10+). */
    val productName: String?,
) {
    /**
     * The name the portal stores. Built from the ids rather than the product string so it survives a replug or a
     * missing permission; two identical models on one machine would share it (a known limit of the scheme).
     */
    val portalName: String get() = PrinterKinds.portalName(vendorId, productId)

    /** Exposes a printer-class (7) or vendor-specific (255) interface with a bulk-OUT endpoint. */
    val isPrinterLike: Boolean
        get() = hasBulkOut && interfaceClasses.any {
            it == PrinterKinds.CLASS_PRINTER || it == PrinterKinds.CLASS_VENDOR_SPECIFIC
        }

    val language: String get() = PrinterKinds.languageFor(vendorId)

    /** A hint only: vendors that mostly ship office inkjets/lasers. Such devices are still listed and usable. */
    val likelyOfficePrinter: Boolean get() = vendorId in PrinterKinds.OFFICE_VENDORS
}

/** The USB layer as the router sees it. The real one is [AndroidUsbPrinterPort]; tests use a fake. */
interface PrinterPort {
    fun listDevices(): List<UsbDeviceInfo>

    /**
     * Writes [bytes] to the device with these ids and returns when the printer has accepted them all. Blocking;
     * asks for USB permission first if needed. [deviceName] pins one physical device when several share the ids.
     * Throws [UsbPrintException].
     */
    fun write(vendorId: Int, productId: Int, bytes: ByteArray, deviceName: String? = null)
}

object PrinterKinds {
    const val CLASS_PRINTER = 7
    const val CLASS_VENDOR_SPECIFIC = 255

    private const val EPSON = 0x04b8
    private const val STAR = 0x0519
    private const val BIXOLON = 0x1504
    private const val CITIZEN = 0x1d90
    private const val CUSTOM = 0x0dd4
    private const val TSC = 0x1203
    private const val ZEBRA = 0x0a5f
    private val ESC_POS_VENDORS = setOf(EPSON, STAR, BIXOLON, CITIZEN, CUSTOM)

    /** HP, Canon, Lexmark, Xerox. (Brother is left out: its QL series are label printers.) */
    val OFFICE_VENDORS = setOf(0x03f0, 0x04a9, 0x043d, 0x0924)

    fun portalName(vendorId: Int, productId: Int): String = "USB printer %04x:%04x".format(vendorId, productId)

    /**
     * What /printers reports and what /test-print sends. Known receipt and Zebra vendors are named; everything
     * else stays TSPL, which is what this bridge reported for every device before the vendor table existed.
     */
    fun languageFor(vendorId: Int): String = when (vendorId) {
        in ESC_POS_VENDORS -> "ESC_POS"
        ZEBRA -> "ZPL"
        TSC -> "TSPL"
        else -> "TSPL"
    }

    fun className(c: Int): String = when (c) {
        1 -> "audio"
        2 -> "comm"
        3 -> "hid"
        7 -> "printer"
        8 -> "mass storage"
        9 -> "hub"
        10 -> "cdc-data"
        255 -> "vendor-specific"
        else -> "class $c"
    }
}
