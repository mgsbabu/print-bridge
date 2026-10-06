# TailorApp Print Bridge

Local agent that lets the TailorApp web app print tags,
receipts, and thermal labels on printers attached to an outlet PC or POS.

See `docs/` for the spec. See `CLAUDE.md` for repo conventions.

## Supported platforms

| Platform | Build | Distribution | Printers |
|---|---|---|---|
| Windows | Electron (`.exe`) | GitHub Releases | Installed printers, network printers |
| macOS | Electron (`.dmg`) | GitHub Releases | Installed printers, network printers |
| Linux | Electron (`.AppImage`, `.deb`) | GitHub Releases | CUPS printers, network printers |
| Android | Native Kotlin app (`.apk`) | GitHub Releases, **sideload** (not on Google Play) | USB printers (raw TSPL / ZPL / ESC-POS) |

All platforms speak the same wire protocol on `127.0.0.1:7755`, so the web app works unchanged.
The Android app lives in `android/`; see [`docs/android-bridge.md`](docs/android-bridge.md) for install, pairing,
signing and troubleshooting.
