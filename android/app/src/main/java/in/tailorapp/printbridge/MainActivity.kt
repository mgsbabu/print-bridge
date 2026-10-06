package `in`.tailorapp.printbridge

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

/**
 * The whole UI: pairing, Start/Stop, and every attached USB device with per-device test buttons. Built in code
 * with framework widgets only, mirroring the desktop tray app's three jobs (pair, show printers, run the bridge).
 */
class MainActivity : Activity() {
    private lateinit var store: BridgeStore
    private lateinit var port: AndroidUsbPrinterPort
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var pairedText: TextView
    private lateinit var codeInput: EditText
    private lateinit var pairButton: Button
    private lateinit var unpairButton: Button
    private lateinit var statusText: TextView
    private lateinit var errorText: TextView
    private lateinit var toggleButton: Button
    private lateinit var autostartSwitch: Switch
    private lateinit var batteryHint: LinearLayout
    private lateinit var printersBox: LinearLayout
    private lateinit var resultText: TextView

    private var printersSignature = ""
    private var starting = false

    private val tick = object : Runnable {
        override fun run() {
            refresh()
            main.postDelayed(this, 1500)
        }
    }

    private val usbEvents = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = refresh(force = true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = BridgeStore(this)
        port = AndroidUsbPrinterPort.get(this)
        setContentView(buildUi())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbEvents, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(usbEvents, filter)
        }
        main.post(tick)
    }

    override fun onPause() {
        main.removeCallbacks(tick)
        unregisterReceiver(usbEvents)
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        refresh(force = true)
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    // -- Layout -------------------------------------------------------------------------------------------

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(24))
        }
        root.addView(text("TailorApp Print Bridge", 22f, bold = true))
        root.addView(text("Version ${BuildConfig.VERSION_NAME}", 12f))

        // -- Pair
        root.addView(heading("1. Pair"))
        pairedText = text("", 14f)
        root.addView(pairedText)
        codeInput = EditText(this).apply {
            hint = "Paste the pairing code from the portal"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            minLines = 2
            maxLines = 4
            textSize = 13f
        }
        root.addView(codeInput)
        val pairRow = row()
        pairButton = button("Pair") { onPair() }
        unpairButton = button("Unpair") { onUnpair() }
        pairRow.addView(pairButton)
        pairRow.addView(unpairButton)
        root.addView(pairRow)

        // -- Bridge
        root.addView(heading("2. Bridge"))
        statusText = text("", 15f, bold = true)
        root.addView(statusText)
        errorText = text("", 13f).apply { setTextColor(0xFFB00020.toInt()) }
        root.addView(errorText)
        toggleButton = button("Start bridge") { onToggle() }
        root.addView(toggleButton)
        autostartSwitch = Switch(this).apply {
            text = "Start automatically after reboot"
            isChecked = store.autostart
            setOnCheckedChangeListener { _, checked -> store.autostart = checked }
        }
        root.addView(autostartSwitch)
        batteryHint = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        batteryHint.addView(text(
            "Battery optimization can stop the bridge in the background. Set this app to \"Unrestricted\" / " +
                "exclude it from battery optimization.", 12f))
        batteryHint.addView(button("Battery settings") { openBatterySettings() })
        root.addView(batteryHint)

        // -- Printers
        root.addView(heading("3. USB devices"))
        root.addView(text(
            "Every attached USB device is listed. The portal picks a printer by its name, so nothing is hidden or " +
                "pinned here.", 12f))
        resultText = text("", 13f)
        root.addView(resultText)
        printersBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(printersBox)

        val scroll = ScrollView(this).apply { addView(root) }
        // targetSdk 35+ draws edge to edge, so keep the content out from under the system bars.
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        return scroll
    }

    private fun text(s: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(2), 0, dp(2))
    }

    private fun heading(s: String) = text(s, 17f, bold = true).apply { setPadding(0, dp(20), 0, dp(4)) }

    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    // -- State --------------------------------------------------------------------------------------------

    private fun refresh(force: Boolean = false) {
        val pairing = store.getPairing()
        pairedText.text = if (pairing == null) {
            "Not paired. In the portal open Hardware / Bridge pairing and generate a pairing code."
        } else {
            "Paired: ${pairing.allowedOrigins().joinToString(", ")}\nTenant ${pairing.tenantId}, org unit ${pairing.orgUnitId}"
        }
        unpairButton.isEnabled = pairing != null

        val running = PrintBridgeService.running
        statusText.text = when {
            running -> "Running on 127.0.0.1:${BridgeRouter.PORT}"
            starting -> "Starting..."
            else -> "Stopped"
        }
        statusText.setTextColor(if (running) 0xFF1B5E20.toInt() else 0xFF555555.toInt())
        toggleButton.text = if (running || starting) "Stop bridge" else "Start bridge"
        errorText.text = if (running) "" else PrintBridgeService.lastError?.let { "Last error: $it" } ?: ""
        batteryHint.visibility = if (isBatteryRestricted()) View.VISIBLE else View.GONE

        val devices = port.listDevices()
        val signature = devices.joinToString("|") { "${it.deviceName}:${it.hasPermission}" }
        if (force || signature != printersSignature) {
            printersSignature = signature
            renderDevices(devices)
        }
    }

    private fun renderDevices(devices: List<UsbDeviceInfo>) {
        printersBox.removeAllViews()
        if (!port.isHostSupported()) {
            printersBox.addView(text("This device has no USB host support, so USB printers cannot be used.", 13f))
            return
        }
        if (devices.isEmpty()) {
            printersBox.addView(text("No USB devices attached. Plug a printer in and check the cable.", 13f))
            return
        }
        devices.forEach { printersBox.addView(deviceCard(it)) }
    }

    private fun deviceCard(d: UsbDeviceInfo): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0x11000000)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(10) }
        }
        val title = "%04x:%04x".format(d.vendorId, d.productId) + (d.productName?.let { "  $it" } ?: "")
        card.addView(text(title, 15f, bold = true))
        card.addView(text("Interfaces: " + (d.interfaceClasses.takeIf { it.isNotEmpty() }
            ?.joinToString(", ") { "${PrinterKinds.className(it)} ($it)" } ?: "none"), 12f))
        card.addView(text("Bulk-OUT: ${yes(d.hasBulkOut)}    USB permission: ${yes(d.hasPermission)}", 12f))
        card.addView(text(
            if (d.isPrinterLike) "Appears in the portal as: \"${d.portalName}\" (${d.language})"
            else "Not offered to the portal (no printer-class bulk-OUT interface)", 12f))
        if (d.likelyOfficePrinter) {
            card.addView(text("Probably an office printer, not a label or receipt printer. Still listed.", 12f)
                .apply { setTextColor(0xFF8A5A00.toInt()) })
        }

        if (!d.hasPermission) {
            card.addView(button("Request USB permission") { port.findDevice(d.deviceName)?.let { dev ->
                port.requestPermission(dev) { refresh(force = true) }
            } })
        }
        val row = row()
        row.addView(button("Test label (TSPL)") {
            testPrint(d, TEST_LABEL.toByteArray(Charsets.US_ASCII), "label")
        }.apply { isEnabled = d.hasBulkOut })
        row.addView(button("Test receipt (ESC/POS)") {
            testPrint(d, TEST_RECEIPT, "receipt")
        }.apply { isEnabled = d.hasBulkOut })
        card.addView(row)
        return card
    }

    private fun yes(b: Boolean) = if (b) "yes" else "no"

    /** Prints to exactly [d] (by device name), never "the first match". */
    private fun testPrint(d: UsbDeviceInfo, bytes: ByteArray, what: String) {
        resultText.text = "Sending test $what to ${d.portalName}..."
        io.execute {
            val result = try {
                port.write(d.vendorId, d.productId, bytes, d.deviceName)
                "Test $what sent to ${d.portalName}."
            } catch (e: UsbPrintException) {
                "Test $what failed (${e.code}): ${e.message}"
            } catch (e: Exception) {
                "Test $what failed: ${e.javaClass.simpleName}"
            }
            main.post {
                resultText.text = result
                Toast.makeText(this, result, Toast.LENGTH_LONG).show()
                refresh(force = true)
            }
        }
    }

    // -- Actions ------------------------------------------------------------------------------------------

    private fun onPair() {
        try {
            store.setPairing(PairingCodes.fromCode(codeInput.text.toString()))
            codeInput.setText("")
            Toast.makeText(this, "Paired", Toast.LENGTH_SHORT).show()
        } catch (e: IllegalArgumentException) {
            Toast.makeText(this, e.message ?: "Invalid pairing code", Toast.LENGTH_LONG).show()
        }
        refresh()
    }

    private fun onUnpair() {
        store.clearPairing()
        refresh()
    }

    private fun onToggle() {
        if (PrintBridgeService.running || starting) {
            starting = false
            PrintBridgeService.stop(this)
            refresh()
            return
        }
        // Android 14+ will not start a connectedDevice foreground service unless the app already holds USB
        // permission for a device, so ask for every attached printer's permission BEFORE starting the service.
        val needing = port.listDevices().filter { it.isPrinterLike && !it.hasPermission }
        starting = true
        refresh()
        requestInOrder(needing.map { it.deviceName }) {
            if (starting) {
                starting = false
                PrintBridgeService.start(this)
            }
            refresh(force = true)
        }
    }

    private fun requestInOrder(names: List<String>, done: () -> Unit) {
        val device = names.firstOrNull()?.let { port.findDevice(it) }
        if (device == null) {
            done()
            return
        }
        // The answer, granted or not, moves on: a refused printer must not keep the bridge from starting.
        port.requestPermission(device) { requestInOrder(names.drop(1), done) }
    }

    private fun isBatteryRestricted(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return !pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun openBatterySettings() {
        try {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
    }
}
