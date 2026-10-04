#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_VITE="$ROOT/node_modules/.bin/electron-vite"

if [[ "$(uname -s)" != "Darwin" ]]; then
  exec "$ELECTRON_VITE" dev "$@"
fi

SOURCE_APP="$ROOT/node_modules/electron/dist/Electron.app"
DEV_ROOT="$ROOT/.cache/dev-electron"
DEV_APP="$DEV_ROOT/Android File Transfer for macOS.app"
DEV_EXECUTABLE="$DEV_APP/Contents/MacOS/Android File Transfer for macOS"
PLIST="$DEV_APP/Contents/Info.plist"
ICON="$ROOT/build/icon.icns"
STAMP="$DEV_ROOT/runtime.sha256"

if [[ ! -d "$SOURCE_APP" || ! -x "$SOURCE_APP/Contents/MacOS/Electron" ]]; then
  echo "Electron.app is missing. Run npm install before starting the app." >&2
  exit 1
fi

if [[ ! -f "$ICON" ]]; then
  echo "The development app icon is missing: $ICON" >&2
  exit 1
fi

FINGERPRINT="$({
  shasum -a 256 "$SOURCE_APP/Contents/Info.plist" "$SOURCE_APP/Contents/MacOS/Electron" "$ICON"
  printf '%s\n' 'android-file-transfer-dev-bundle-v2'
} | shasum -a 256 | awk '{print $1}')"

CURRENT_FINGERPRINT=""
if [[ -f "$STAMP" ]]; then
  CURRENT_FINGERPRINT="$(<"$STAMP")"
fi

if [[ ! -x "$DEV_EXECUTABLE" || "$CURRENT_FINGERPRINT" != "$FINGERPRINT" ]]; then
  rm -rf "$DEV_APP"
  mkdir -p "$DEV_ROOT"
  if ! /bin/cp -cR "$SOURCE_APP" "$DEV_APP" 2>/dev/null; then
    rm -rf "$DEV_APP"
    /bin/cp -R "$SOURCE_APP" "$DEV_APP"
  fi

  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Android File Transfer for macOS" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName Android File Transfer for macOS" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Android File Transfer for macOS" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.autonomath.androidfiletransfer.dev" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile app-icon.icns" "$PLIST"
  /usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.utilities" "$PLIST"
  /bin/mv "$DEV_APP/Contents/MacOS/Electron" "$DEV_EXECUTABLE"
  /bin/cp "$ICON" "$DEV_APP/Contents/Resources/app-icon.icns"
  /usr/bin/codesign --force --deep --sign - "$DEV_APP" >/dev/null
  printf '%s\n' "$FINGERPRINT" > "$STAMP"
fi

ELECTRON_EXEC_PATH="$DEV_EXECUTABLE" exec "$ELECTRON_VITE" dev "$@"
