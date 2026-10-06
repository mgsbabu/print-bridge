package `in`.tailorapp.printbridge

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Writes raw bytes (TSPL, ZPL or ESC/POS; this layer does not care) to a USB printer through its bulk-OUT
 * endpoint. There is no "pinned" printer: [write] goes to exactly the device it is told to, and the portal
 * decides which one that is.
 *
 * Payloads are only held in memory for the duration of a call and are never logged or persisted.
 */
class AndroidUsbPrinterPort private constructor(context: Context) : PrinterPort {
    private val app = context.applicationContext
    private val usb = app.getSystemService(Context.USB_SERVICE) as UsbManager

    // One print at a time: two writers interleaving bytes would corrupt both jobs.
    private val writeLock = Any()
    private val pending = ConcurrentHashMap<String, MutableList<(Boolean) -> Unit>>()
    @Volatile private var receiverRegistered = false

    companion object {
        private const val TAG = "UsbPrinterPort"
        private const val ACTION_PERMISSION = "in.tailorapp.printbridge.USB_PERMISSION"
        private const val CHUNK = 4096
        private const val WRITE_TIMEOUT_MS = 5000
        private const val PERMISSION_TIMEOUT_S = 30L

        // Holds the application context only, so it cannot leak an Activity.
        @SuppressLint("StaticFieldLeak")
        @Volatile private var instance: AndroidUsbPrinterPort? = null

        fun get(context: Context): AndroidUsbPrinterPort =
            instance ?: synchronized(this) {
                instance ?: AndroidUsbPrinterPort(context).also { instance = it }
            }
    }

    fun isHostSupported(): Boolean = app.packageManager.hasSystemFeature("android.hardware.usb.host")

    override fun listDevices(): List<UsbDeviceInfo> = usb.deviceList.values.map { d ->
        val granted = usb.hasPermission(d)
        UsbDeviceInfo(
            deviceName = d.deviceName,
            vendorId = d.vendorId,
            productId = d.productId,
            deviceClass = d.deviceClass,
            interfaceClasses = (0 until d.interfaceCount).map { d.getInterface(it).interfaceClass },
            hasBulkOut = bulkOutOf(d) != null,
            hasPermission = granted,
            productName = if (granted) d.productName else null,
        ).also {
            // Ids and classes only. Never payload bytes.
            Log.d(TAG, "usb device vid=%04x pid=%04x class=%d ifaces=%s bulkOut=%b".format(
                it.vendorId, it.productId, it.deviceClass, it.interfaceClasses, it.hasBulkOut))
        }
    }

    fun findDevice(deviceName: String): UsbDevice? = usb.deviceList.values.firstOrNull { it.deviceName == deviceName }

    override fun write(vendorId: Int, productId: Int, bytes: ByteArray, deviceName: String?) {
        if (!isHostSupported()) throw UsbPrintException(UsbPrintException.NO_USB_HOST, "This device has no USB host support")
        synchronized(writeLock) {
            val device = usb.deviceList.values.firstOrNull {
                it.vendorId == vendorId && it.productId == productId &&
                    (deviceName == null || it.deviceName == deviceName) && bulkOutOf(it) != null
            } ?: throw UsbPrintException(UsbPrintException.NO_DEVICE, "USB printer %04x:%04x is not attached".format(vendorId, productId))
            if (!usb.hasPermission(device)) awaitPermission(device)

            val (iface, endpoint) = bulkOutOf(device)
                ?: throw UsbPrintException(UsbPrintException.NO_ENDPOINT, "Printer has no bulk-OUT endpoint")
            val conn = usb.openDevice(device)
                ?: throw UsbPrintException(UsbPrintException.IO_ERROR, "Could not open the printer (unplugged?)")
            try {
                if (!conn.claimInterface(iface, true)) {
                    throw UsbPrintException(UsbPrintException.IO_ERROR, "Could not claim the printer interface")
                }
                sendChunks(conn, endpoint, bytes)
            } finally {
                conn.releaseInterface(iface)
                conn.close()
            }
        }
    }

    private fun sendChunks(conn: UsbDeviceConnection, ep: UsbEndpoint, bytes: ByteArray) {
        var offset = 0
        while (offset < bytes.size) {
            val len = minOf(CHUNK, bytes.size - offset)
            val chunk = bytes.copyOfRange(offset, offset + len)
            val sent = conn.bulkTransfer(ep, chunk, len, WRITE_TIMEOUT_MS)
            if (sent <= 0) {
                // bulkTransfer has no separate timeout code: -1 after the full window means the printer is not
                // draining (powered off, out of paper, buffer full), not that the cable is dead.
                throw UsbPrintException(
                    UsbPrintException.TIMEOUT,
                    "Printer did not accept data ($offset of ${bytes.size} bytes sent). Check it is on and has paper.",
                )
            }
            offset += sent
        }
    }

    // -- USB permission -----------------------------------------------------------------------------------

    /**
     * Asks Android for permission to talk to [device] and calls [onResult] with the answer (on the main thread, or
     * right away if it is already held). Does not block.
     */
    fun requestPermission(device: UsbDevice, onResult: (Boolean) -> Unit) {
        if (usb.hasPermission(device)) {
            onResult(true)
            return
        }
        ensureReceiver()
        val list = pending.getOrPut(device.deviceName) { java.util.Collections.synchronizedList(mutableListOf()) }
        val first = synchronized(list) { list.add(onResult); list.size == 1 }
        if (!first) return // a prompt for this device is already showing
        // The system fills EXTRA_DEVICE / EXTRA_PERMISSION_GRANTED into this intent, so on Android 12+ the
        // PendingIntent must be FLAG_MUTABLE. Setting the package keeps it explicit, which Android 14 requires
        // of a mutable one.
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pi = PendingIntent.getBroadcast(app, 0, Intent(ACTION_PERMISSION).setPackage(app.packageName), flags)
        usb.requestPermission(device, pi)
    }

    /** Blocks (up to 30 s) until the user answers the prompt. Only for worker threads, never the main thread. */
    private fun awaitPermission(device: UsbDevice) {
        val latch = CountDownLatch(1)
        var granted = false
        requestPermission(device) { granted = it; latch.countDown() }
        if (!latch.await(PERMISSION_TIMEOUT_S, TimeUnit.SECONDS)) {
            // Forget the stale request, or the next attempt would think a prompt is still showing and never ask.
            pending.remove(device.deviceName)
            throw UsbPrintException(UsbPrintException.TIMEOUT, "USB permission prompt was not answered")
        }
        if (!granted) throw UsbPrintException(UsbPrintException.PERMISSION_DENIED, "USB permission was denied")
    }

    // Before Android 13 a dynamic receiver cannot be marked not-exported, so another app could in theory send a
    // fake permission result. The worst it achieves is a failed openDevice() (the real permission is still checked
    // by the system), so this is accepted rather than adding a signature permission just for API 24-32.
    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun ensureReceiver() {
        if (receiverRegistered) return
        synchronized(this) {
            if (receiverRegistered) return
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    val device = deviceFrom(i) ?: return
                    val granted = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    val callbacks = pending.remove(device.deviceName) ?: return
                    synchronized(callbacks) { callbacks.toList() }.forEach { it(granted) }
                }
            }
            val filter = IntentFilter(ACTION_PERMISSION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                app.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                app.registerReceiver(receiver, filter)
            }
            receiverRegistered = true
        }
    }

    @Suppress("DEPRECATION")
    private fun deviceFrom(i: Intent): UsbDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
            i.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }

    /** Prefers a printer-class interface over a vendor-specific one. */
    private fun bulkOutOf(d: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
        val ifaces = (0 until d.interfaceCount).map { d.getInterface(it) }
            .sortedBy { if (it.interfaceClass == UsbConstants.USB_CLASS_PRINTER) 0 else 1 }
        for (i in ifaces) {
            for (e in 0 until i.endpointCount) {
                val ep = i.getEndpoint(e)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    return i to ep
                }
            }
        }
        return null
    }
}
