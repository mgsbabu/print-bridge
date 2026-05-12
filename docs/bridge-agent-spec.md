# TailorApp Print Bridge — Spec & Build Guide

> A downloadable desktop agent that lets the TailorApp web app print
> tags / receipts / thermal labels on locally-attached printers in
> outlet shops. The browser cannot talk USB or raw TCP:9100; the
> Bridge runs on the operator's PC and gives the cloud web app a
> well-typed HTTP API on `http://127.0.0.1:7755` to push print jobs
> through.
>
> The backend + web app already speak the Bridge protocol (see
> `module/labelprint/` and `features/label-print/dispatch.ts`). This
> document is the spec + guide to build the standalone agent that
> closes the loop.

---

## Table of contents

1. [What the Bridge does](#what-the-bridge-does)
2. [Architecture](#architecture)
3. [Wire protocol](#wire-protocol-v1)
4. [Functional requirements](#functional-requirements)
5. [Non-functional requirements](#non-functional-requirements)
6. [Tech stack](#tech-stack)
7. [Repo & project setup](#repo--project-setup)
8. [Working with Claude Code on this project](#working-with-claude-code-on-this-project)
9. [Implementation milestones](#implementation-milestones)
10. [Build & packaging](#build--packaging)
11. [Code signing](#code-signing)
12. [Hosting & distribution](#hosting--distribution)
13. [Auto-update](#auto-update)
14. [Tenant install + onboarding](#tenant-install--onboarding)
15. [Support runbook](#support-runbook)
16. [Extension points](#extension-points)
17. [Roadmap beyond v1](#roadmap-beyond-v1)

---

## What the Bridge does

The TailorApp cloud (Spring Boot backend + Next.js web app) needs to
push print jobs to printers physically attached to an outlet's PC.
The web app is restricted by the browser sandbox; it can't:

- Open a USB connection to a Zebra ZD220.
- Open a raw TCP socket to `192.168.1.30:9100` on the outlet LAN.
- Bypass the OS print-dialog confirmation that interrupts every job.

The Bridge runs on the outlet's PC as a desktop application + local
HTTP server. The web app POSTs print jobs to
`http://127.0.0.1:7755/print` over CORS-allowed HTTPS / HTTP-on-
localhost. The Bridge translates that into a real print:

- Send the bytes to an OS print queue.
- Open a TCP socket to a network printer.
- Send a raw USB control transfer to a USB printer.

Three job kinds in v1:

| Kind | Payload | Output target |
|---|---|---|
| `PDF` | Base64 PDF bytes | OS print queue (any printer with a driver) |
| `ZPL` | UTF-8 ZPL command stream | OS raw queue (Zebra/TSC) or TCP:9100 |
| `ESC_POS` *(v1.1)* | Raw ESC/POS bytes | USB or LAN thermal receipt printer |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Outlet PC                                                │
│                                                          │
│  ┌─────────────────┐                                     │
│  │ TailorApp web   │   POST /print                       │
│  │ (browser tab)   ├─────────┐                           │
│  └─────────────────┘         │                           │
│                              ▼                           │
│                  ┌────────────────────────┐              │
│                  │  TailorApp Print Bridge│              │
│                  │  Electron tray app     │              │
│                  │                        │              │
│                  │  ┌──────────────────┐  │              │
│                  │  │ Express server   │  │              │
│                  │  │ 127.0.0.1:7755   │  │              │
│                  │  └────────┬─────────┘  │              │
│                  │           │            │              │
│                  │  ┌────────▼─────────┐  │              │
│                  │  │ Dispatcher       │  │              │
│                  │  │  - pdf-to-printer│  │              │
│                  │  │  - net.Socket    │  │              │
│                  │  │  - escpos        │  │              │
│                  │  └────────┬─────────┘  │              │
│                  │           │            │              │
│                  │  ┌────────▼─────────┐  │              │
│                  │  │ Logger + telemetry│ │              │
│                  │  └──────────────────┘  │              │
│                  │                        │              │
│                  │   System tray icon     │              │
│                  └────────────────────────┘              │
│                              │                           │
│         ┌────────────────────┼──────────────────┐        │
│         ▼                    ▼                  ▼        │
│   ┌──────────┐        ┌──────────┐       ┌──────────┐    │
│   │ Zebra USB│        │ TSC LAN  │       │ Star TSP │    │
│   │ ZPL      │        │ ZPL :9100│       │ ESC/POS  │    │
│   └──────────┘        └──────────┘       └──────────┘    │
└──────────────────────────────────────────────────────────┘
```

Key invariants:

- **Loopback only by default.** The HTTP server binds to `127.0.0.1`,
  never a routable interface. Cross-origin requests from the
  TailorApp web origin only.
- **Auth via shared token.** First-run pairing flow stores an HMAC
  token. Every `/print` carries `X-Bridge-Token`. Token rotates from
  the tenant admin UI.
- **Stateful job log.** Every job dispatched (success or fail) goes
  to a local SQLite DB so the operator can audit "what printed and
  when."
- **No outbound calls except auto-update.** The Bridge talks back to
  the cloud only for self-update checks and (optional) crash
  reports.

---

## Wire protocol (v1)

Exactly the shape the TailorApp web app already speaks. Don't change
it without coordinating a backend release.

### `GET /health`

```json
{
  "version": "1.0.3",
  "os": "win32",
  "loadedPrinters": [
    {
      "name": "Zebra-ZD220",
      "language": "ZPL",
      "mediaWidthMm": 50,
      "mediaHeightMm": 15,
      "mediaKind": "WASHABLE",
      "isDefault": false,
      "online": true
    }
  ],
  "tenantId": 13,
  "orgUnitId": 12,
  "uptimeSeconds": 38221
}
```

### `GET /printers`

Same `loadedPrinters` array as `/health`, no envelope.

### `POST /print`

Request:

```json
{
  "printerName": "Zebra-ZD220",
  "language": "ZPL",
  "payloadBase64": "XlhBXkNJMjheUFczMDA...",
  "copies": 3,
  "jobRef": 482
}
```

`language` ∈ `PDF | ZPL | ESC_POS`. `jobRef` is the backend's
`tag_print_jobs.id`; the Bridge echoes it back in logs so the cloud
can reconcile.

Success response:

```json
{ "dispatched": true, "copiesAcknowledged": 3 }
```

Failure response (any 4xx/5xx):

```json
{
  "dispatched": false,
  "copiesAcknowledged": 0,
  "error": "Printer offline",
  "errorCode": "PRINTER_OFFLINE"
}
```

Error codes the web app pattern-matches on:

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Token missing / wrong |
| `PRINTER_NOT_FOUND` | Name not in the loaded list |
| `PRINTER_OFFLINE` | Driver reports offline |
| `MEDIA_OUT` | Out of labels / paper |
| `RIBBON_OUT` | Out of ribbon (thermal transfer) |
| `BAD_PAYLOAD` | Base64 decode failed / unsupported language |
| `INTERNAL` | Catch-all; see `error` |

### `POST /test-print`

```json
{ "printerName": "Zebra-ZD220" }
```

Emits a fixed `BRIDGE OK / <yyyy-mm-dd HH:mm>` 50×15mm sample. Used
in the System Configuration UI to isolate driver problems from data
problems.

### `POST /pair` *(first-run only)*

Web app calls this once with a freshly-generated token after the
operator scans the pairing QR. The Bridge stores
`{ tenantId, orgUnitId, token }` and starts accepting authenticated
calls.

```json
{
  "tenantId": 13,
  "orgUnitId": 12,
  "token": "Z9aT...64chars",
  "tenantOrigin": "https://app.tailorapp.in"
}
```

After pair, the Bridge accepts requests only from `tenantOrigin`
(CORS) bearing the matching token.

### CORS

```
Access-Control-Allow-Origin: <paired tenant origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Bridge-Token
Access-Control-Max-Age: 600
```

No wildcard. Pre-flight OPTIONS handled.

---

## Functional requirements

### MUST (v1)

- Run on Windows 10/11, macOS 12+, Ubuntu 22.04+.
- HTTP server on `127.0.0.1:7755` (configurable port).
- Implement the 4 endpoints above.
- Enumerate locally-installed printers via the OS.
- Print **PDF** to any OS-installed printer driver.
- Print **ZPL** to:
  - A Zebra/TSC printer installed as a Windows raw queue.
  - A network printer at `IP:9100`.
- **Test print** that doesn't depend on tenant data.
- System tray icon with: status (paired / online / error), Open
  Logs, Reload Printers, Quit.
- Crash recovery: agent restarts itself on uncaught exception.
- Auto-update from a published release feed.

### SHOULD (v1.1)

- **ESC/POS** receipt printing (Star TSP, Epson TM-T82).
- Per-printer media size override (some Zebra drivers misreport).
- Throttle: max N jobs per minute to protect from runaway loops.
- Job retry on transient failure (printer warming up).

### COULD (v2)

- Silent mode (no system print dialog ever).
- Ribbon-out / media-out pause-and-resume.
- Web-app pre-flight: "Bridge is online, print will not bounce."
- Multi-tenant pairing (one Bridge talks to multiple tenants).
- Mobile-app integration via mDNS.

---

## Non-functional requirements

| Concern | Bar |
|---|---|
| Cold-start latency | < 2 s from tray-click to first print accepted |
| Per-job dispatch | < 500 ms end-to-end on LAN, < 1.5 s on USB |
| Memory footprint | < 200 MB resident |
| Installer size | < 80 MB on Windows, < 100 MB on Mac (Electron baseline) |
| Telemetry | Opt-in only. Crash reports never include payload bytes. |
| Auth | Token never echoed back in any response or log file |
| CORS | Strict allow-list; wildcard origin disallowed at build |
| Self-update | Signed updates only; downgrade attacks rejected |
| Logging | Rotating file logs, 30-day retention, 5 MB cap |
| Security | No payload bytes in persistent storage > 24 h |

---

## Tech stack

**Electron + Node.js 20 + TypeScript.** Reasons:

- Cross-platform packaging (one repo → 3 installers).
- Mature printer ecosystem: `pdf-to-printer`, `printer`,
  `escpos-printer`, `node-thermal-printer`.
- Native system tray + auto-updater (`electron-updater`).
- Plenty of code signing examples for Windows / Mac.

Alternatives evaluated:

| Stack | Pro | Con | Verdict |
|---|---|---|---|
| Tauri (Rust) | 5 MB binary, fast | Printer libs sparse on Rust side | Skip |
| Go + Wails | Single binary | System tray is OS-by-OS hand-rolled | Skip |
| C# / .NET MAUI | Best Windows printer support | Mac/Linux story weak | Skip if cross-platform mandatory |
| Pure Node + Tray | Smaller install | No proper tray on macOS without native bindings | Skip |

### Dependency picks

```json
{
  "dependencies": {
    "electron": "^33",
    "electron-store": "^10",
    "electron-updater": "^6.3",
    "express": "^4.21",
    "cors": "^2.8.5",
    "better-sqlite3": "^11.3",
    "pdf-to-printer": "^5.6",
    "@grandchef/node-printer": "^1.0",
    "node-thermal-printer": "^4.4",
    "qrcode": "^1.5",
    "pino": "^9.5",
    "pino-rotating-file-stream": "^1",
    "zod": "^3.23"
  },
  "devDependencies": {
    "typescript": "^5.6",
    "tsx": "^4.19",
    "electron-builder": "^25",
    "@types/express": "^5",
    "@types/cors": "^2.8",
    "vitest": "^2.1",
    "eslint": "^9"
  }
}
```

---

## Repo & project setup

### 1. Create the repo

```bash
mkdir print-bridge && cd print-bridge
git init -b main
gh repo create mgsbabu/print-bridge --public --source=. --remote=origin
```

Repo conventions:

- Default branch: `main`.
- Protected — direct pushes only by maintainers; everything else via
  PRs.
- Tag every shipping release `v1.0.0` etc; release notes live in
  `RELEASES.md`.

### 2. Project skeleton

```
print-bridge/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── .github/
│   ├── workflows/
│   │   ├── ci.yml          # lint + test on push
│   │   └── release.yml     # build + sign + upload on tag
│   └── ISSUE_TEMPLATE/
├── src/
│   ├── main/               # Electron main process
│   │   ├── index.ts        # boots tray + HTTP server
│   │   ├── tray.ts
│   │   ├── server.ts       # express
│   │   ├── auth.ts
│   │   ├── store.ts        # electron-store wrapper
│   │   ├── dispatcher/
│   │   │   ├── index.ts
│   │   │   ├── pdf.ts
│   │   │   ├── zpl.ts
│   │   │   ├── escpos.ts
│   │   │   └── printers.ts # enumerate OS printers
│   │   ├── jobs/
│   │   │   ├── db.ts       # sqlite
│   │   │   └── repository.ts
│   │   ├── updater.ts
│   │   └── logger.ts
│   ├── renderer/           # tiny preferences window
│   │   ├── index.html
│   │   └── prefs.tsx
│   └── shared/
│       ├── protocol.ts     # request/response zod schemas
│       └── error-codes.ts
├── assets/
│   ├── icon.icns
│   ├── icon.ico
│   ├── icon.png
│   └── tray-*.png
├── docs/
│   ├── pairing.md
│   ├── troubleshooting.md
│   └── developer.md
├── test/
│   ├── http-contract.test.ts
│   └── dispatcher/*.test.ts
├── RELEASES.md
└── README.md
```

### 3. Initial config files

`package.json` (key bits):

```json
{
  "name": "print-bridge",
  "version": "0.1.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "tsx watch src/main/index.ts",
    "build": "tsc -p tsconfig.json",
    "package": "npm run build && electron-builder",
    "package:win": "npm run build && electron-builder --win",
    "package:mac": "npm run build && electron-builder --mac",
    "package:linux": "npm run build && electron-builder --linux",
    "lint": "eslint src test",
    "test": "vitest run"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`electron-builder.yml`:

```yaml
appId: in.tailorapp.printbridge
productName: TailorApp Print Bridge
copyright: Copyright © 2026 TailorApp
directories:
  output: release
files:
  - dist/**/*
  - assets/**/*
  - node_modules/**/*
  - package.json
asarUnpack:
  - node_modules/better-sqlite3/**
  - node_modules/@grandchef/node-printer/**

mac:
  category: public.app-category.utilities
  hardenedRuntime: true
  gatekeeperAssess: false
  icon: assets/icon.icns
  notarize: true

win:
  target: nsis
  icon: assets/icon.ico
  publisherName: TailorApp Technologies Pvt Ltd
  signAndEditExecutable: true

linux:
  target:
    - AppImage
    - deb
  icon: assets/icon.png
  category: Utility

publish:
  provider: github
  owner: mgsbabu
  repo: print-bridge
  releaseType: release
```

---

## Working with Claude Code on this project

Claude Code (the CLI) is the recommended pair-programmer for the
Bridge. Quick setup:

```bash
cd print-bridge
npm install -g @anthropic-ai/claude-code
claude  # spawns the CLI in the repo
```

Drop a `CLAUDE.md` at the repo root so Claude has the project
context every session:

```markdown
# TailorApp Print Bridge — Claude notes

## Environment
- Node 20, TypeScript 5.6, Electron 33
- Mac dev primary; Windows builds via GitHub Actions
- Build: `npm run build` then `npm run package`

## Wire protocol contract
- /print, /printers, /health, /test-print, /pair
- Frozen: changing the shape requires a coordinated backend ship
- Backend code that consumes the protocol:
  https://github.com/mgsbabu/tailorapp -> features/label-print/dispatch.ts

## Conventions
- src/main/* is Electron main process — no DOM APIs
- src/renderer/* runs in the prefs window (Chromium) — no fs/net there
- All HTTP request bodies validated by zod schemas in src/shared/protocol.ts
- New error codes go to src/shared/error-codes.ts AND backend pattern-match table
- Logger: import { log } from "./logger" — never console.log in production

## Conversation kickers
- "Add ESC/POS support" -> dispatcher/escpos.ts + protocol.ts + tests
- "Add a printer" -> dispatcher/printers.ts enumeration + UI in renderer/prefs.tsx
- "Bump version" -> package.json version field + tag v1.x.y, GH Actions does the rest
```

Useful prompts in early development:

- *"Scaffold the express server in src/main/server.ts with the four
  v1 endpoints. Bodies validated by zod. Auth middleware reads
  the token from electron-store. Cite the backend dispatch.ts wire
  shape verbatim."*
- *"Write src/main/dispatcher/pdf.ts. On Windows, use
  pdf-to-printer; on Mac/Linux, shell out to `lp`. Return
  copiesAcknowledged based on what the OS reports."*
- *"Add the system tray with status icon. Icon should be green when
  paired + healthy, yellow when paired-but-no-printers, red when
  unpaired or HTTP server died."*

When Claude proposes a fix involving the wire protocol, always link
the corresponding backend file as ground truth.

---

## Implementation milestones

Suggested sequencing. Each milestone is a PR; each PR ends with a
working tray app you can manually exercise.

### M0 — Bootstrap (1 day)

- [ ] Repo + tsconfig + electron-builder + GH Actions skeleton.
- [ ] Empty Electron app boots a tray icon.
- [ ] `npm run package:mac` produces a `.dmg`.

### M1 — HTTP server + auth + pairing (2 days)

- [ ] `src/shared/protocol.ts` with zod schemas mirroring the spec.
- [ ] `src/main/server.ts` with `/health`, `/pair`, auth middleware.
- [ ] `src/main/store.ts` persists the paired token securely via
      `electron-store` with OS keychain encryption.
- [ ] Pairing UX: tray menu shows "Pair with TailorApp" → opens a
      window with a `pairing-code` field; on submit POSTs `/pair` to
      itself with the seed token.
- [ ] Vitest contract tests for every endpoint (401 without token,
      200 with valid token, 400 on bad body).

### M2 — Printer enumeration + PDF dispatch (2 days)

- [ ] `src/main/dispatcher/printers.ts` lists OS printers via
      `pdf-to-printer.getPrinters()` and `node-printer`.
- [ ] Tray menu "Reload Printers" refreshes the cache.
- [ ] `src/main/dispatcher/pdf.ts` accepts PDF base64, writes to
      tmpfile, dispatches via `pdf-to-printer`.
- [ ] `POST /print` with `language: "PDF"` reaches a real printer.
- [ ] Integration test against PDFKit-generated 50×15mm sample.

### M3 — ZPL dispatch (2 days)

- [ ] `src/main/dispatcher/zpl.ts` with two paths:
      - Network: `net.createConnection(ip, 9100)` → write bytes.
      - Local: Windows raw queue via `node-printer`.
- [ ] Network-printer config: tray UI adds an "Add network printer"
      form (name, IP, port, default media).
- [ ] `POST /test-print` works against both paths.
- [ ] Validation against labelary.com renders before sending bytes.

### M4 — Job log + UI polish (2 days)

- [ ] `src/main/jobs/db.ts` SQLite schema:
      `jobs(id, ts, printer, language, copies_requested,
       copies_acknowledged, status, error)`.
- [ ] Every dispatch persists a row before/after.
- [ ] Tray menu "Open Logs" opens the SQLite-backed log viewer
      (renderer window with a table).
- [ ] Status icon reflects last 5-minute success rate.
- [ ] Toast on first-run pairing success.

### M5 — Auto-update + signing (3 days, Mac + Win)

- [ ] `electron-updater` wired to GitHub Releases.
- [ ] Mac notarization via `@electron/notarize`.
- [ ] Win code signing via Azure Trusted Signing or SignPath.
- [ ] CI workflow `.github/workflows/release.yml` builds + signs +
      publishes draft release on `v*` tag push.
- [ ] Manual smoke: install v1.0.0, push v1.0.1, agent picks it up
      within 6 h and prompts to restart.

### M6 — ESC/POS for receipts (3 days, v1.1)

- [ ] `src/main/dispatcher/escpos.ts` using `node-thermal-printer`.
- [ ] USB device picker in prefs window (`node-usb`).
- [ ] Receipt PDF → ESC/POS conversion only when the operator picks
      "Receipt printer" media in the tenant web app.

### M7 — Crash recovery + telemetry (2 days)

- [ ] `process.on('uncaughtException')` restarts the HTTP server
      cleanly without restarting Electron.
- [ ] Opt-in Sentry hook (`SENTRY_DSN` baked at build) — strips
      payload bytes from breadcrumbs.
- [ ] Health endpoint surfaces last 50 errors for support runbook.

Total v1: roughly **12–14 dev days** for one engineer. ESC/POS +
silent printing add another 5–7.

---

## Build & packaging

### Local dev

```bash
npm install
npm run dev        # tsx watches main process
# in another shell:
curl -sS http://127.0.0.1:7755/health | jq
```

### Local installers (no signing)

```bash
npm run package        # current platform
npm run package:win    # cross-build to Windows (Wine on mac required)
npm run package:linux  # cross-build to Linux
```

Output lands in `release/`:

- `TailorApp Print Bridge Setup 1.0.0.exe` (Windows NSIS)
- `TailorApp Print Bridge-1.0.0.dmg` (macOS)
- `TailorApp Print Bridge-1.0.0.AppImage` (Linux)
- `print-bridge_1.0.0_amd64.deb` (Debian/Ubuntu)

### CI build (signed releases)

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Package
        run: npm run package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Mac signing
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          # Win signing
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: bridge-${{ matrix.os }}
          path: release/*
```

---

## Code signing

Don't ship unsigned binaries. Windows SmartScreen and macOS Gatekeeper
will block them and operators will phone you in panic.

### Windows

Options ordered by cost:

1. **Azure Trusted Signing** (~$10/mo) — recommended. Code is
   signed in the cloud, no USB token to lose.
2. **SignPath.io** (free for OSS) — alternative if you want
   community/OSS plan.
3. **Sectigo / DigiCert EV cert** ($300–500/yr) — old school, ships
   on a USB token, harder to automate.

Set `WIN_CSC_LINK` (path or HTTPS URL to PFX) +
`WIN_CSC_KEY_PASSWORD` in repo secrets.

### macOS

You need an Apple Developer Program account ($99/yr).

1. Create a **Developer ID Application** certificate in Apple
   Developer portal.
2. Export as `.p12` with password.
3. Generate an **app-specific password** under Apple ID security.
4. Set secrets: `MAC_CSC_LINK` (base64 `.p12`),
   `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`.

`electron-builder` calls `@electron/notarize` automatically when
`mac.notarize: true` and these envs are set.

### Linux

No signing infrastructure; ship AppImage + `.deb`. Verify checksums
on the download page.

---

## Hosting & distribution

### Release artifact storage

**GitHub Releases.** Free, CDN-fronted, integrates with
`electron-updater` out of the box. The `release.yml` workflow above
already publishes there.

Don't put binaries in your S3 bucket. The bandwidth and signed-URL
churn isn't worth it when GH Releases handles it for free.

### Download page on the tenant web app

Add a `/system/print-bridge` page in the TailorApp web app that:

- Detects the operator's OS (User-Agent).
- Surfaces the right download link to the latest GitHub release.
- Renders the install + pairing walkthrough.
- Generates the pairing token on-the-fly + shows the pairing QR.

Reuse the existing `features/label-print/api-client.ts` shape:

```ts
// New endpoint on the backend
export async function generateBridgePairingToken(orgUnitId: number) {
  return apiPost<
    { token: string; tenantId: number; orgUnitId: number; expiresAt: string },
    { orgUnitId: number }
  >("/api/v1/label-print/bridge/pair", { orgUnitId });
}
```

Backend persists `bridge_pairings(tenant, org_unit, token_hash,
issued_at, last_seen_at, version, revoked)`; the Bridge's `/health`
calls back nightly so admins can see "online" / "offline" in the
admin UI.

---

## Auto-update

`electron-updater` + GitHub Releases handles the heavy lifting. Add
to `src/main/updater.ts`:

```ts
import { autoUpdater } from "electron-updater";
import { log } from "./logger";

export function startAutoUpdate() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Every 6 hours, plus 30 s after startup.
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 30_000);
  setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000);

  autoUpdater.on("update-downloaded", () => {
    // Wait until the agent has been idle for 2 minutes, then
    // quit + relaunch.
    scheduleIdleRestart();
  });
}
```

Tag a release `v1.0.4` and push; within 6 hours every installed
Bridge picks it up. Operators see a tray notification; restart on
their schedule.

**Downgrade protection:** `electron-updater` already refuses lower
versions. Don't bypass.

---

## Tenant install + onboarding

End-to-end flow the outlet operator goes through:

1. **Tenant admin** opens TailorApp web → System → Print Bridge.
2. Page shows download links + a one-time pairing code.
3. Operator clicks the download for their OS — installer fires up.
4. **Windows**: NSIS installer offers "Install for current user"
   (no admin password needed). **macOS**: `.dmg`, drag to
   Applications.
5. Bridge launches; tray icon goes red ("Not paired").
6. Operator clicks tray → **"Pair with TailorApp"**.
7. A pairing window opens locally → operator pastes the code from
   the web page.
8. Bridge POSTs `/pair` to itself with `{token, tenantId, orgUnitId}`;
   stores in OS keychain.
9. Tray icon goes green. `/health` reflects the binding.
10. Operator clicks **"Reload Printers"**; the printer list appears
    in the web app's template editor + the order Tags screen.
11. Operator hits **"Send test print"** in the web UI; a real label
    spits out of the printer. Done.

Setup time target: **under 5 minutes** from "download" to "first
real tag printed".

### Pairing code lifecycle

- Issued by backend; expires in 15 minutes.
- One-shot — consumed by the first `/pair` call.
- Tenant admin can revoke any paired Bridge from the same page.
  Revoke flips `bridge_pairings.revoked=true`; next `/health`
  beacon receives `401` and the Bridge flips to "unpaired".

---

## Support runbook

When a tenant calls saying "tags don't print":

| Symptom | First check | Likely fix |
|---|---|---|
| Tray icon red | `GET http://127.0.0.1:7755/health` from browser | Re-pair |
| Tray icon yellow | "Reload printers" | Driver not installed; install Zebra driver |
| Print dialog never appears | Browser pop-up blocker | Allow pop-ups for the TailorApp origin |
| "Bridge unreachable" toast | `curl http://127.0.0.1:7755/health` | Firewall blocking loopback; allow port 7755 |
| Job logged FAILED with `MEDIA_OUT` | Look at printer | Load labels |
| Job logged FAILED with `INTERNAL` | Open tray → View Logs | Email log line to support |
| Tags print blurry | Printer's media size doesn't match template | Edit template width/height to match |
| Print is offset / rotated | Driver "fit to page" enabled | Disable in driver UI |

The Bridge ships with a **Submit Diagnostic** menu item that zips:

- Last 7 days of `pino` logs.
- Last 50 SQLite job rows (redacted: no payload bytes).
- `/health` snapshot.
- OS / Bridge / Electron version.

Operator drops the zip in a support form on the TailorApp web app
(or emails to `support@tailorapp.in`).

---

## Extension points

The dispatcher is intentionally a strategy pattern so adding a
printer language doesn't ripple:

```ts
// src/main/dispatcher/index.ts
export interface Dispatcher {
  language: "PDF" | "ZPL" | "ESC_POS" | "DPL" | "ESC_P";
  dispatch(req: PrintRequest): Promise<DispatchResult>;
}

const dispatchers: Record<string, Dispatcher> = {
  PDF: pdfDispatcher,
  ZPL: zplDispatcher,
  // Add here:
  // ESC_POS: escposDispatcher,
};
```

To add a new printer language:

1. Implement `Dispatcher` in `src/main/dispatcher/<lang>.ts`.
2. Register in the lookup table above.
3. Add the enum value to `src/shared/protocol.ts`.
4. Coordinate with backend: add to `RenderKind` enum + renderer.
5. Ship synchronously across Bridge + Backend.

Other extension points worth knowing:

- `src/main/store.ts` exposes `getTenant() / setTenant()` —
  multi-tenant pairing means making this a list.
- `src/main/jobs/repository.ts` — add columns for new audit fields
  without breaking the public `/health` shape.
- `src/main/dispatcher/printers.ts` — adding a printer source (e.g.
  Bluetooth thermal) goes here, not in dispatcher files.

---

## Roadmap beyond v1

| Phase | Items |
|---|---|
| v1.1 | ESC/POS receipts, per-printer media overrides, job throttle |
| v1.2 | Silent print mode (no OS dialog), retry on transient fail |
| v2.0 | Multi-tenant pairing; one Bridge serves multiple TailorApp accounts (chains) |
| v2.1 | Mobile app integration via mDNS discovery; phone POSTs to the LAN-discovered Bridge |
| v2.2 | Inline ZPL preview pane (open-source pure-JS ZPL renderer) |
| v2.3 | Roll up + chart per-printer stats (jobs/day, error rate) in tray menu |
| v3.0 | Headless server mode for chain HQs (one Bridge box per outlet rack room) |

---

## Quick checklist for shipping v1.0.0

- [ ] Code-signed installers for Win / Mac on GH Releases.
- [ ] `electron-updater` configured and tested between two builds.
- [ ] `https://app.tailorapp.in/system/print-bridge` page live with
      OS-detected download links + pairing flow.
- [ ] Backend `bridge_pairings` table + `POST /label-print/bridge/pair`
      endpoint shipped.
- [ ] Status indicator in tenant admin UI showing online/offline
      Bridges per outlet.
- [ ] Support runbook circulated to support staff.
- [ ] One pilot tenant signed off after a full week of production
      use across all three job kinds.

Once those are green, flip the platform-wide `BRIDGE_AVAILABLE`
feature flag on, and the order-detail Tags screen will start
offering bridge dispatch as the default for tenants with at least
one paired Bridge.
