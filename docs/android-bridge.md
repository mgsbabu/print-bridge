# Android Print Bridge

A small native Android app (Kotlin, no WebView, no React Native) that does what the desktop tray app does, on an
Android POS: it pairs with the portal, runs the same HTTP server on `127.0.0.1:7755`, and writes raw bytes
(TSPL / ZPL / ESC-POS) to a USB printer. The web app talks to it exactly as it talks to the desktop bridge.

It is **sideloaded**. It is not published to Google Play. The APK is attached to each GitHub Release next to the
`.exe` / `.dmg`:

```
TailorApp-Print-Bridge-<version>.apk      applicationId  in.tailorapp.printbridge
```

The source is in `android/`. The wire protocol is the one in `src/main/server.ts` and `src/shared/protocol.ts`
and is **not** changed by this app.

| | Desktop bridge | Android bridge |
|---|---|---|
| Endpoints | `/health /printers /print /test-print /pair` | same |
| Languages | PDF, ZPL, ESC_POS, TSPL | ZPL, ESC_POS, TSPL (PDF returns `400 BAD_PAYLOAD`) |
| Printer names | OS printer names | `USB printer vvvv:pppp` (USB vendor:product, lower-case hex) |
| Bound to | `127.0.0.1` | `127.0.0.1` |

## Install on a POS

1. Download `TailorApp-Print-Bridge-<version>.apk` from the GitHub Release.
2. Install it, either:
   - **adb:** `adb install -r TailorApp-Print-Bridge-<version>.apk` (USB debugging on; the `-r` keeps the pairing
     when upgrading), or
   - **on the device:** copy the APK over (USB stick, download link), allow **Install unknown apps** for the app you
     open it with, then tap the file.
3. Open **TailorApp Print Bridge** once. Allow notifications when asked (Android 13+).
4. Set the app to **Unrestricted / not battery optimized** (the app shows a hint and a button) so Android does not
   kill the bridge in the background.

## Pair and use

1. In the portal open **Hardware → Bridge pairing → Generate pairing code**.
2. Paste the code into the app's **Pair** box and tap **Pair**. The paired origin is shown above the box.
3. Tap **Start bridge**. Android asks for USB permission for each attached printer (tick "use by default" to
   stop it asking again), then the service starts. A "Print Bridge running" notification stays up while it runs.
4. In the portal's Hardware page the bridge should show **Online**, with printers listed as
   `USB printer vvvv:pppp`. Pick the right one for labels and for receipts.
5. Optional: leave **Start automatically after reboot** on. The bridge then comes back after a reboot, but only if
   it was running when the device shut down and the app is paired.

The app lists **every** attached USB device with its vendor/product ids, interface classes, whether it has a
bulk-OUT endpoint, whether USB permission is held, and the name it will have in the portal. Each device has
**Test label (TSPL)** and **Test receipt (ESC/POS)** buttons that print to *that* device. There is deliberately no
"pin to one printer" setting: the portal chooses a printer by name per request. (An earlier build had a pin, and a
pinned HP inkjet hid the Epson receipt printer so every print went to the wrong device.) Devices that look like
office printers (HP, Canon, Lexmark, Xerox) are marked as such but still listed and usable.

## Build it yourself

Requirements: JDK 17 and the Android SDK (platform 36, build-tools 36). Gradle 9.0.0 comes from the wrapper.

```bash
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties      # not committed
./gradlew :app:testDebugUnitTest      # JVM unit tests, no device needed
./gradlew :app:assembleRelease        # Windows: gradlew.bat
# -> android/app/build/outputs/apk/release/app-release.apk
```

Without signing properties the release APK is signed with the **debug** keystore and Gradle prints a warning. That
is for local testing only; do not hand such a build out, because it can never be upgraded in place by the real one.

The version comes from `-PAPP_VERSION_NAME=1.2.3` (CI passes the git tag), falling back to `package.json`.
`versionCode` is `major*10000 + minor*100 + patch`.

Toolchain, pinned because the combination is known to build: Gradle 9.0.0, Android Gradle Plugin 8.12.0, Kotlin
2.1.20, compileSdk/targetSdk 36, minSdk 24. AGP 9.x needs Gradle 9.1 or newer, so bump both together.

## Release signing and CI

The release APK is signed with a key you own, read from Gradle properties or environment variables. Nothing is in
the repo.

### 1. Create the keystore (once)

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore tailorapp-printbridge.keystore \
  -alias printbridge -keyalg RSA -keysize 4096 -validity 10000
```

Keep this file and its passwords somewhere safe and backed up. **If it is lost, installed devices cannot be
upgraded**; the APK would have to be uninstalled and reinstalled with a new key. Never commit it (`*.keystore` and
`*.jks` are gitignored under `android/`).

### 2. Set the GitHub secrets (once)

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 tailorapp-printbridge.keystore` (macOS: `base64 -i … \| tr -d '\n'`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `printbridge` (or whatever you chose) |
| `ANDROID_KEY_PASSWORD` | the key password (the same as the store password for PKCS12 unless you set it apart) |

### 3. Release

Pushing a `v*` tag runs the `android` job in `.github/workflows/release.yml` after the desktop jobs. It runs the unit
tests, builds the signed APK, names it `TailorApp-Print-Bridge-<version>.apk` and uploads it to the same GitHub
Release as the `.exe` / `.dmg`. **A tag build fails if `ANDROID_KEYSTORE_BASE64` is missing**; it will not publish
a debug-signed APK.

For a validation build without a release: Actions → Release → Run workflow → `platform = android`. That produces a
downloadable artifact, signed with the debug key if the secrets are not set.

To sign locally with the real key instead:

```bash
./gradlew :app:assembleRelease \
  -PRELEASE_STORE_FILE=/path/tailorapp-printbridge.keystore \
  -PRELEASE_STORE_PASSWORD=... -PRELEASE_KEY_ALIAS=printbridge -PRELEASE_KEY_PASSWORD=...
```

(or put the four `RELEASE_*` values in `~/.gradle/gradle.properties`, outside the repo).

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Portal shows the bridge **Offline** | The app is not running (open it, tap **Start bridge**), Android killed it (set battery to Unrestricted), or on Chrome a Local Network Access permission is blocking the page (allow it in the site settings). `http://127.0.0.1:7755/health` in Chrome on the POS should answer a `401` JSON when no token is sent; if it does not load at all the service is down. |
| App says "Android refused to start the service…" | Android 14+ will not start the foreground service until the app holds USB permission for a device. Plug the printer in and tap **Start bridge** again, then accept the USB prompt. |
| "Last error: … Address already in use" | Something else holds port 7755 (a second copy of the bridge). Stop it and start again. |
| `PRINTER_NOT_FOUND` from the portal | The printer name saved in the portal is stale: it was chosen for a different USB device, or the printer is unplugged. The name is `USB printer vvvv:pppp`; compare it with the list in the app and re-select the printer in the portal. |
| `PRINTER_OFFLINE` | USB permission was denied, the write timed out (printer off, out of paper, buffer not draining), or the cable was pulled mid-print. Try the per-device test button in the app; its message says which. |
| Printer is not in the list at all | The POS does not see it. Try another cable or port, or a powered hub. If the device is not in the app's list it is a hardware/cable problem, not a bridge problem. |
| Device is listed but "Not offered to the portal" | It has no printer-class or vendor-specific interface with a bulk-OUT endpoint, so it cannot take raw data. |
| Nothing prints after a reboot | **Start automatically after reboot** must be on, the app must be paired, and the bridge must have been running when the device went down (an explicit **Stop** disables the restart). Android 14+ may also refuse the foreground start until USB permission is held: open the app and tap **Start bridge**. |
| `BAD_PAYLOAD … not supported on Android` | The job is `PDF`. The Android bridge prints raw TSPL / ZPL / ESC-POS only; pick a raw-capable printer or a desktop bridge for PDF jobs. |
| Receipt prints garbage on a label printer (or the reverse) | The wrong printer is chosen in the portal for that job type. Use the app's test buttons to confirm which device is which. |

## What the app never does

- Bind to anything but `127.0.0.1`.
- Log, store or forward label or receipt payloads. Only USB vendor/product ids, interface classes and error
  messages are logged.
- Connect out to the network. It declares `INTERNET` only because Android requires that permission for any socket,
  including the loopback listener; the code makes no outbound connections.
