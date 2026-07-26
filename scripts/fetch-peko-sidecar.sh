#!/usr/bin/env bash
# fetch-peko-sidecar.sh — copy the freshly-built `peko-daemon`
# binary into the desktop's Tauri sidecar location.
#
# Why this exists
# ---------------
# `peko-desktop` is a Tauri app that bundles the `peko-daemon`
# runtime as a sidecar (see ADR-043). Tauri requires sidecar
# binaries to live at `src-tauri/binaries/<name>-<rust-target-triple>`
# so the build script can find and bundle them. The two repos
# (peko-runtime and peko-desktop) are independent, so we need an
# explicit copy step.
#
# The supervisor invokes `peko-daemon` directly (Phase 0.Z-C removed
# the in-process fallback the CLI used to provide, so going through
# `peko daemon start --foreground` would require the daemon sibling
# to be present anyway). The CLI binary is no longer needed by the
# desktop bundle at all — only the daemon binary ships.
#
# Usage
# -----
#   scripts/fetch-peko-sidecar.sh [path/to/peko-runtime]
#
# `path/to/peko-runtime` defaults to the value of $PEKO_RUNTIME_DIR if
# set, then to `../peko-runtime` (the convention used in CI and in the
# author's local checkout).
#
# Profile
# -------
# The script reads `CARGO_PROFILE` (defaults to `release`) so a debug
# sidecar can be fetched for dev work without rebuilding release.
#
# What it does
# ------------
# 1. Locate the source binary at
#      <source>/target/<CARGO_PROFILE>/peko-daemon[.exe]
# 2. Detect the host target triple via `rustc -vV | grep ^host`.
# 3. Copy to `src-tauri/binaries/peko-daemon-<triple>[.exe]`
#    (creating the directory if needed).
# 4. Make the copy executable.
# 5. Verify the copy runs and prints its version line via
#    `peko-daemon --help` (the binary's only flag-aware path; it
#    does not exit until told to). We use `--help` rather than
#    `--version` because the binary has no `--version` flag — only
#    `--help`, which prints version + flag surface.
#
# Exits non-zero on any failure. Logs every step to stderr so CI can
# surface the failure clearly.

set -euo pipefail

# Resolve the source directory (peko-runtime checkout).
SOURCE="${1:-${PEKO_RUNTIME_DIR:-../peko-runtime}}"
if [ ! -d "$SOURCE" ]; then
    echo "❌ peko-runtime source not found at: $SOURCE" >&2
    echo "   Pass it as the first arg, or set PEKO_RUNTIME_DIR." >&2
    exit 1
fi

# Profile (release is what we ship; debug is for local dev).
PROFILE="${CARGO_PROFILE:-release}"

# Resolve target triple.
if ! command -v rustc >/dev/null 2>&1; then
    echo "❌ rustc not found on PATH; required to detect the target triple." >&2
    exit 1
fi
TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
if [ -z "$TRIPLE" ]; then
    echo "❌ could not parse target triple from 'rustc -vV'" >&2
    exit 1
fi

# Windows executables carry the .exe suffix; Tauri expects the suffix
# to match the source.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) EXE_SUFFIX=".exe" ;;
    *) EXE_SUFFIX="" ;;
esac

# Source + destination.
SOURCE_BIN="$SOURCE/target/$PROFILE/peko-daemon$EXE_SUFFIX"
if [ ! -x "$SOURCE_BIN" ]; then
    echo "❌ peko-daemon binary not found at: $SOURCE_BIN" >&2
    echo "   Build it first: cd $SOURCE && cargo build --$PROFILE -p peko-daemon-bin" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$SCRIPT_DIR/../src-tauri/binaries"
DEST_BIN="$DEST_DIR/peko-daemon-$TRIPLE$EXE_SUFFIX"

mkdir -p "$DEST_DIR"
echo "📦 Copying $SOURCE_BIN → $DEST_BIN"
cp "$SOURCE_BIN" "$DEST_BIN"
chmod +x "$DEST_BIN"

# Sanity check — make sure the copy runs and reports its surface.
echo "🔍 Verifying $DEST_BIN --help"
if ! "$DEST_BIN" --help; then
    echo "❌ copied binary failed to run; refusing to proceed." >&2
    exit 1
fi

echo "✅ sidecar fetched: $DEST_BIN"