# TailorApp Print Bridge — Claude notes

## Environment
- Node 20, TypeScript 5.6, Electron 33
- Dev: macOS primary; Windows builds via GitHub Actions
- Build: `npm run build` then `npm run package`

## Wire protocol contract (frozen against backend)
- Endpoints: /health, /printers, /print, /test-print, /pair
- Shape definitions: src/shared/protocol.ts (zod schemas)
- Changing the protocol requires a coordinated backend release
- Backend that consumes the protocol:
  https://github.com/mgsbabu/tailorapp
  -> web-app/src/features/label-print/dispatch.ts
  -> backend/src/main/java/com/tailorapp/module/labelprint/

## Project conventions
- src/main/*   -- Electron main process; Node APIs only, no DOM
- src/renderer/* -- prefs window (Chromium); no fs/net, IPC only
- src/shared/* -- types/schemas reused across main + renderer
- All HTTP request bodies validated by zod (src/shared/protocol.ts)
- New error codes go in src/shared/error-codes.ts AND the backend's
  pattern-match table -- ship in lockstep
- Logger: import { log } from "./logger"; never console.log in prod
- No payload bytes persisted >24h (security requirement)

## Tray app behaviour
- Icon green: paired + at least one printer reachable
- Icon yellow: paired + zero printers loaded
- Icon red: unpaired OR HTTP server died

## Conversation kickers
- "Add ESC/POS support" -> dispatcher/escpos.ts + protocol.ts enum + tests
- "Add a network printer" -> dispatcher/printers.ts + renderer prefs UI
- "Bump version" -> package.json version field; tag v1.x.y;
  GH Actions release.yml does the rest
- "Diagnose a failed job" -> open SQLite db at <userData>/jobs.db,
  inspect the row whose jobRef matches the backend's tag_print_jobs.id

## Things NOT to do
- Don't bind the HTTP server to 0.0.0.0 -- loopback only by contract
- Don't log payloadBase64 anywhere -- breaks the security NFR
- Don't change the /print response shape without backend coordination
- Don't ship unsigned installers -- SmartScreen/Gatekeeper will block