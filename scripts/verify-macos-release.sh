#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_PATH="${1:?Usage: verify-macos-release.sh DMG_OR_ZIP_PATH arm64|x64 [VERSION]}"
ARCH="${2:?Usage: verify-macos-release.sh DMG_OR_ZIP_PATH arm64|x64 [VERSION]}"
DEFAULT_VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
EXPECTED_VERSION="${3:-$DEFAULT_VERSION}"
EXPECTED_TEAM_ID="${EXPECTED_TEAM_ID:?Set EXPECTED_TEAM_ID to the signing certificate Apple Developer Team ID.}"
EXPECTED_MINIMUM_MACOS="${EXPECTED_MINIMUM_MACOS:-$(node -p 'require(process.argv[1]).build.mac.minimumSystemVersion' "$ROOT/package.json")}"
PRODUCT_NAME="Android File Transfer for macOS"
ARTIFACT_NAME="$(basename "$ARTIFACT_PATH")"
STAGE_POINT="$(mktemp -d "${TMPDIR:-/tmp}/android-file-transfer-release.XXXXXX")"
MOUNTED=false

cleanup() {
  if [[ "$MOUNTED" == true ]]; then
    if hdiutil detach "$STAGE_POINT" -quiet >/dev/null 2>&1; then
      rmdir "$STAGE_POINT" >/dev/null 2>&1 || true
    else
      echo "Could not detach release DMG at $STAGE_POINT" >&2
    fi
  else
    rm -rf "$STAGE_POINT"
  fi
}
trap cleanup EXIT

case "$ARCH" in
  arm64|x64) ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac

case "$ARTIFACT_NAME" in
  "Android-File-Transfer-for-macOS-$EXPECTED_VERSION-$ARCH.dmg") ARTIFACT_KIND=dmg ;;
  "Android-File-Transfer-for-macOS-$EXPECTED_VERSION-$ARCH.zip") ARTIFACT_KIND=zip ;;
  *) echo "Unexpected release artifact name: $ARTIFACT_NAME" >&2; exit 1 ;;
esac

signing_details() {
  codesign -dv --verbose=4 "$1" 2>&1
}

assert_team_id() {
  local binary="$1"
  local details
  local actual_team
  details="$(signing_details "$binary")"
  actual_team="$(awk -F= '/^TeamIdentifier=/{print $2; exit}' <<< "$details")"
  [[ "$actual_team" == "$EXPECTED_TEAM_ID" ]]
}

assert_hardened_runtime() {
  local binary="$1"
  local details
  details="$(signing_details "$binary")"
  grep -Eq '^CodeDirectory .*flags=.*runtime' <<< "$details"
}

assert_usb_entitlement() {
  local helper="$1"
  local entitlements
  entitlements="$(codesign -d --entitlements - "$helper" 2>/dev/null)"
  awk '
    /\[Key\] com\.apple\.security\.device\.usb/ { usb_entitlement = 1; next }
    usb_entitlement && /\[Bool\] true/ { valid = 1; exit }
    END { exit valid ? 0 : 1 }
  ' <<< "$entitlements"
}

if [[ "$ARTIFACT_KIND" == dmg ]]; then
  codesign --verify --verbose=2 "$ARTIFACT_PATH"
  xcrun stapler validate "$ARTIFACT_PATH"
  spctl --assess --type open --context context:primary-signature --verbose=4 "$ARTIFACT_PATH"
  hdiutil attach "$ARTIFACT_PATH" -nobrowse -readonly -mountpoint "$STAGE_POINT" -quiet
  MOUNTED=true
else
  ditto -x -k "$ARTIFACT_PATH" "$STAGE_POINT"
fi

APP_PATH="$STAGE_POINT/$PRODUCT_NAME.app"
INFO_PLIST="$APP_PATH/Contents/Info.plist"
HELPER="$APP_PATH/Contents/Resources/bin/mtp-json"
UPDATE_CONFIG="$APP_PATH/Contents/Resources/app-update.yml"
[[ -d "$APP_PATH" && -f "$INFO_PLIST" ]]
[[ -f "$UPDATE_CONFIG" ]]
node --input-type=module - "$UPDATE_CONFIG" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(process.argv[2], 'utf8');
for (const [key, expected] of Object.entries({
  provider: 'github',
  owner: 'autonomath',
  repo: 'android-file-transfer-for-macos'
})) {
  const matches = [...config.matchAll(new RegExp(`^${key}:\\s*([^\\s#]+)\\s*$`, 'gm'))];
  assert.equal(matches.length, 1, `Expected exactly one ${key} field in app-update.yml`);
  assert.equal(matches[0][1].replace(/^['"]|['"]$/g, ''), expected, `Unexpected ${key} in app-update.yml`);
}
NODE
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")" == "$EXPECTED_VERSION" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST")" == "$EXPECTED_VERSION" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$INFO_PLIST")" == "$EXPECTED_MINIMUM_MACOS" ]]
assert_team_id "$APP_PATH"
assert_hardened_runtime "$APP_PATH"

for relative_path in \
  'Contents/Resources/bin/mtp-json' \
  'Contents/Resources/bin/file-promise-drag.node' \
  'Contents/Resources/lib/libmtp.9.dylib' \
  'Contents/Resources/lib/libusb-1.0.0.dylib'; do
  BINARY="$APP_PATH/$relative_path"
  codesign --verify --strict --verbose=2 "$BINARY"
  assert_team_id "$BINARY"
done

assert_hardened_runtime "$HELPER"
assert_usb_entitlement "$HELPER"
node "$ROOT/scripts/check-macho.mjs" --root "$APP_PATH" --arch "$ARCH" --max-macos "$EXPECTED_MINIMUM_MACOS"
echo "Verified signed, notarized $ARCH $ARTIFACT_KIND for version $EXPECTED_VERSION: $ARTIFACT_PATH"
