#!/usr/bin/env bash
# Local production build for macOS.
#
# Windows / Linux installers are produced by .github/workflows/release.yml
# on tag push (cross-compiling native modules from a Mac is unreliable).

set -euo pipefail
cd "$(dirname "$0")"

echo "==> Cleaning previous build outputs"
rm -rf dist release

echo "==> Typechecking"
npm run typecheck

echo "==> Building macOS DMG"
npm run package:mac

echo ""
echo "==> Artifacts:"
ls -lh release/*.dmg release/*.yml 2>/dev/null || true

if command -v open >/dev/null 2>&1; then
  open release/
fi
