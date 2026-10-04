#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?Usage: smoke-packaged-app.sh APP_PATH arm64|x64}"
ARCH="${2:?Usage: smoke-packaged-app.sh APP_PATH arm64|x64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT_NAME="Android File Transfer for macOS"
EXPECTED_HOST=""

case "$ARCH" in
  arm64) EXPECTED_HOST="arm64" ;;
  x64) EXPECTED_HOST="x86_64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac

if [[ "${REQUIRE_NATIVE_HOST:-true}" == "true" && "$(uname -m)" != "$EXPECTED_HOST" ]]; then
  echo "Expected a native $EXPECTED_HOST runner, found $(uname -m)." >&2
  exit 1
fi

HELPER="$APP_PATH/Contents/Resources/bin/mtp-json"
EXECUTABLE="$APP_PATH/Contents/MacOS/$PRODUCT_NAME"
[[ -x "$HELPER" && -x "$EXECUTABLE" ]]

STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/android-file-transfer-status.XXXXXX")"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/android-file-transfer-launch.XXXXXX")"
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill -TERM "$APP_PID" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! kill -0 "$APP_PID" >/dev/null 2>&1; then break; fi
      sleep 0.1
    done
    kill -KILL "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$STATUS_FILE"
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

node "$ROOT/scripts/run-release-command.mjs" 20 "$HELPER" status > "$STATUS_FILE"
node -e '
  const fs = require("node:fs");
  const line = fs.readFileSync(process.argv[1], "utf8")
    .split(/\n/)
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) throw new Error("Packaged helper returned no JSON status");
  const status = JSON.parse(line);
  if (typeof status.state !== "string" || !Array.isArray(status.rawDevices)) {
    throw new Error("Packaged helper returned an invalid status shape");
  }
' "$STATUS_FILE"

if ! node "$ROOT/scripts/run-release-command.mjs" 30 "$EXECUTABLE" --disable-gpu --file-promise-smoke > "$LOG_DIR/addon-stdout.log" 2> "$LOG_DIR/addon-stderr.log"; then
  echo "Packaged file-promise addon failed to load in the signed Electron host." >&2
  sed -n '1,80p' "$LOG_DIR/addon-stderr.log" >&2
  exit 1
fi
if ! grep -q '^PACKAGED_FILE_PROMISE_DRAG_OK$' "$LOG_DIR/addon-stdout.log"; then
  echo "Packaged file-promise addon smoke test returned no success marker." >&2
  sed -n '1,80p' "$LOG_DIR/addon-stdout.log" >&2
  sed -n '1,80p' "$LOG_DIR/addon-stderr.log" >&2
  exit 1
fi

"$EXECUTABLE" --disable-gpu > "$LOG_DIR/stdout.log" 2> "$LOG_DIR/stderr.log" &
APP_PID=$!
sleep 5
if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
  echo "Packaged app exited during its launch smoke test." >&2
  sed -n '1,80p' "$LOG_DIR/stderr.log" >&2
  exit 1
fi

echo "Packaged $ARCH helper, file-promise addon, and app launch smoke test passed on $(uname -m)."
