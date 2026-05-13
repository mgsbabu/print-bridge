# Code signing & auto-update — operator guide

This is the deployment guide for shipping signed, notarized,
auto-updating builds via `git push --tags`. The bridge code itself
is already wired; what follows is the secrets + accounts you need to
set up once.

## TL;DR

| Platform | What you need | Cost |
|---|---|---|
| macOS | Apple Developer Program + Developer ID Application cert | $99/yr |
| Windows | Azure Trusted Signing OR SignPath OR Sectigo/DigiCert EV | $10–500/yr |
| Linux | Nothing | $0 |

## Required GitHub repo secrets

Set these in **Settings → Secrets and variables → Actions**. The
`release.yml` workflow consumes them via env vars electron-builder
recognizes.

| Secret | Maps to env | Used for |
|---|---|---|
| `MAC_CERT_P12_BASE64` | `CSC_LINK` | macOS signing certificate (base64 of the `.p12`) |
| `MAC_CERT_PASSWORD` | `CSC_KEY_PASSWORD` | Password protecting the `.p12` |
| `APPLE_ID` | `APPLE_ID` | Your Apple Developer email |
| `APPLE_APP_SPECIFIC_PASSWORD` | `APPLE_APP_SPECIFIC_PASSWORD` | Generate at appleid.apple.com → "App-Specific Passwords" |
| `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | 10-char Team ID from developer.apple.com → "Membership Details" |
| `WIN_CERT_P12_BASE64` | `WIN_CSC_LINK` | Windows signing certificate (base64 of the `.pfx`) |
| `WIN_CERT_PASSWORD` | `WIN_CSC_KEY_PASSWORD` | Password protecting the `.pfx` |
| `GITHUB_TOKEN` | `GH_TOKEN` | Auto-provided by Actions, used to upload release artifacts |

If any secret is unset, electron-builder warns and ships an
**unsigned** artifact for that platform. Unsigned macOS apps get
Gatekeeper-quarantined on first launch; unsigned Windows installers
trip SmartScreen. Don't ship those.

## macOS setup (one-time)

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/).
2. In Apple Developer portal → Certificates → "+" → **Developer ID Application** → follow the prompts to generate.
3. Open Keychain Access on the same Mac → find the cert → right-click → Export → choose `.p12`, set a password.
4. Base64-encode the exported file:
   ```bash
   base64 -i DeveloperIDApp.p12 | pbcopy
   ```
   Paste into the `MAC_CERT_P12_BASE64` GitHub secret.
5. Apple ID → Security → App-Specific Passwords → "+" → label it "FabTailor Bridge notarize" → copy into `APPLE_APP_SPECIFIC_PASSWORD`.
6. Set `APPLE_ID` (email) and `APPLE_TEAM_ID` from Membership Details.

## Windows setup (one-time, pick one)

### Option A — Azure Trusted Signing (recommended)

Cloud-signed, no USB token, ~$10/mo.

1. Create an Azure account, enable the Trusted Signing service.
2. Follow [Azure's "use with electron-builder"](https://learn.microsoft.com/en-us/azure/trusted-signing/) — this involves an `azuresigntool` CLI rather than a static `.pfx`. The current `release.yml` assumes static-`.pfx` signing; switching to Azure requires replacing `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` with `signtoolOptions.sign` pointing at a custom hook script.

### Option B — SignPath.io

Free for OSS; commercial otherwise.

1. Sign up at signpath.io, register the project, get a signing profile.
2. Either upload a self-issued `.pfx` or use SignPath's signing-as-a-service.
3. Static `.pfx` path: set `WIN_CERT_P12_BASE64` + `WIN_CERT_PASSWORD` exactly like macOS.

### Option C — Sectigo / DigiCert EV cert

Old-school. Ships on a USB HSM, very hard to automate. Skip unless you already have one.

## Tagging a release

Local:
```bash
# Bump package.json version, commit.
git tag v1.0.0
git push origin v1.0.0
```

What happens:
1. `release.yml` triggers on tag push.
2. Three jobs (mac, win, linux) run in parallel.
3. Each builds, signs, and uploads artifacts via `--publish always` against `GH_TOKEN`.
4. A draft GitHub Release named `v1.0.0` appears with `.dmg`, `.exe`, `.AppImage`, `.deb`, `.yml` manifests, and `.blockmap` files.
5. Promote the draft to published when you're ready.

## How auto-update works

Once the bridge is installed on an outlet PC (any signed `v1.0.0`
build), `src/main/updater.ts` runs:

- **30 seconds after launch:** check the GitHub Releases feed.
- **Every 6 hours after:** check again.
- **On any "newer version found":** download in the background.
- **When the bridge has been idle for ≥ 2 minutes** (no `/print`
  activity, queried from the local jobs SQLite): `quitAndInstall()`,
  Electron relaunches into the new version.

Operators do nothing. There's also `autoInstallOnAppQuit: true` so if
the user quits manually, the next launch is the new version.

## Downgrade protection

`electron-updater` refuses to apply a lower version than what's
running. If you accidentally publish `v1.0.4` then need to roll back,
publish `v1.0.5` with the old code rather than re-tagging `v1.0.3`.

## Smoke testing the chain (manual)

The only thing that can't be auto-tested is the cross-version
upgrade. The procedure:

1. Tag and ship `v1.0.0`. Install on a test Mac + Windows machine.
2. Bump `package.json` to `1.0.1`, push tag `v1.0.1`.
3. Wait up to 6 hours (or restart the bridge to trigger the 30s
   warmup check). Watch the bridge logs at `<userData>/...` — should
   see `auto-update: downloaded` then `auto-update: bridge idle,
   applying update` then a relaunch.
4. Confirm the tray menu shows the new version in `/health` via
   `curl -H 'X-Bridge-Token: ...' http://127.0.0.1:7755/health`.

If anything is unsigned / un-notarized, the auto-update will silently
fail on macOS (the OS refuses to launch the new `.app`). Check Console.app for `RBSAssertionDescription` errors during the restart.

## Telemetry (opt-in Sentry)

The bridge ships with a Sentry hook that **does nothing unless the
`SENTRY_DSN` env var is set at build time**. No DSN ⇒ no init ⇒
zero network calls to Sentry.

When enabled, both `beforeBreadcrumb` and `beforeSend` run every
event through `scrub()`:

- Any key matching `payloadBase64` / `^token$` / `tokenEnc` /
  `x-bridge-token` / `bridgeToken` / `Authorization` / `Cookie`
  is replaced with `[REDACTED]`.
- Any free-form string > 256 chars that looks like base64 is replaced
  with `[BASE64 REDACTED]` (catches payload bytes that leak into
  error messages).

Neither the print payload nor the bridge token can leave the box.

### How "baked at build" works

`process.env.SENTRY_DSN` is read at runtime, but the env var doesn't
survive into the packaged `.app` — the user's shell isn't the bridge's
shell. To bake the DSN in for production:

**Option 1 — electron-builder extraMetadata.** Add to `release.yml`:

```yaml
- run: npx electron-builder ${{ matrix.ebargs }} --publish always
  env:
    SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
  # The .env-style approach: write a tiny module before build.
```

**Option 2 — pre-build env file.** Write `src/main/sentry-dsn.ts`
during CI, gitignored:

```bash
echo "process.env.SENTRY_DSN = '${{ secrets.SENTRY_DSN }}';" \
  > src/main/sentry-dsn.ts
```

Then import it at the top of `src/main/index.ts`. The generated file
sets `process.env.SENTRY_DSN` before `initTelemetry()` runs.

Local dev: don't set the DSN. The hook stays dormant.
