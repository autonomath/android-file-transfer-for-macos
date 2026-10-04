#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:?Usage: release-macos.sh arm64|x64}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
MINIMUM_MACOS="$(node -p "require('$ROOT/package.json').build.mac.minimumSystemVersion")"
PRODUCT_NAME="Android File Transfer for macOS"
SIGNING_IDENTITY="${SIGNING_IDENTITY:?Set SIGNING_IDENTITY to the exact Developer ID Application identity.}"
CSC_CERTIFICATE_NAME="${CSC_CERTIFICATE_NAME:?Set CSC_CERTIFICATE_NAME to the certificate name electron-builder must select.}"
EXPECTED_TEAM_ID="${EXPECTED_TEAM_ID:?Set EXPECTED_TEAM_ID to the signing certificate Apple Developer Team ID.}"
OUTPUT_ROOT="$ROOT/release/$ARCH"
ASSET_DIR="${RELEASE_ASSET_DIR:-$ROOT/release/assets}"

case "$ARCH" in
  arm64) BUILDER_ARCH_FLAG="--arm64" ;;
  x64) BUILDER_ARCH_FLAG="--x64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac

NOTARY_AUTH=()
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  NOTARY_AUTH=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  NOTARY_AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  NOTARY_AUTH=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
  if [[ -n "${APPLE_KEYCHAIN:-}" ]]; then
    NOTARY_AUTH+=(--keychain "$APPLE_KEYCHAIN")
  fi
else
  echo "Apple notarization credentials are not configured. Set APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER; APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID; or APPLE_KEYCHAIN_PROFILE." >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"

export TARGET_ARCH="$ARCH"
export MACOSX_DEPLOYMENT_TARGET="$MINIMUM_MACOS"
export NATIVE_DEPS_PREFIX="$ROOT/.native-deps/$ARCH"
# electron-builder expects the certificate's name without its Keychain kind prefix.
export CSC_NAME="${CSC_CERTIFICATE_NAME#Developer ID Application: }"

"$ROOT/scripts/build-native-deps.sh" "$ARCH"
npm run check
npm run check:public-source
npm audit --omit=dev --audit-level=high
node "$ROOT/scripts/check-macho.mjs" --root "$ROOT/resources" --arch "$ARCH" --max-macos "$MINIMUM_MACOS"

npx electron-builder --mac zip "$BUILDER_ARCH_FLAG" --publish never \
  --config.directories.output="$OUTPUT_ROOT"
APP_PATH="$(find "$OUTPUT_ROOT" -maxdepth 3 -type d -name "$PRODUCT_NAME.app" -print -quit)"
[[ -n "$APP_PATH" ]]

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
if [[ "$ARCH" == x64 && "$(uname -m)" == arm64 ]]; then
  REQUIRE_NATIVE_HOST=false bash "$ROOT/scripts/smoke-packaged-app.sh" "$APP_PATH" "$ARCH"
else
  bash "$ROOT/scripts/smoke-packaged-app.sh" "$APP_PATH" "$ARCH"
fi
APP_ZIP="$OUTPUT_ROOT/Android-File-Transfer-for-macOS-$VERSION-$ARCH.zip"
[[ -f "$APP_ZIP" ]]
xcrun notarytool submit "$APP_ZIP" "${NOTARY_AUTH[@]}" --wait
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
rm -f "$APP_ZIP"

# The first ZIP makes electron-builder write app-update.yml before signing and
# serves as Apple's notarization submission. Replace it with a ZIP of the
# stapled app; the pre-staple ZIP must never be offered as an update payload.
npx electron-builder --mac zip "$BUILDER_ARCH_FLAG" --publish never \
  --prepackaged "$APP_PATH" \
  --config.directories.output="$OUTPUT_ROOT"
UPDATE_ZIP="$OUTPUT_ROOT/Android-File-Transfer-for-macOS-$VERSION-$ARCH.zip"
[[ -f "$UPDATE_ZIP" ]]

npx electron-builder --mac dmg "$BUILDER_ARCH_FLAG" --publish never \
  --prepackaged "$APP_PATH" \
  --config.directories.output="$OUTPUT_ROOT"
DMG_PATH="$(find "$OUTPUT_ROOT" -maxdepth 1 -type f -name "Android-File-Transfer-for-macOS-$VERSION-$ARCH.dmg" -print -quit)"
[[ -n "$DMG_PATH" ]]

codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$DMG_PATH"
codesign --verify --verbose=2 "$DMG_PATH"
xcrun notarytool submit "$DMG_PATH" "${NOTARY_AUTH[@]}" --wait
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

FINAL_DMG="$ASSET_DIR/$(basename "$DMG_PATH")"
FINAL_ZIP="$ASSET_DIR/$(basename "$UPDATE_ZIP")"
cp "$DMG_PATH" "$FINAL_DMG"
cp "$UPDATE_ZIP" "$FINAL_ZIP"
"$ROOT/scripts/verify-macos-release.sh" "$FINAL_DMG" "$ARCH" "$VERSION"
"$ROOT/scripts/verify-macos-release.sh" "$FINAL_ZIP" "$ARCH" "$VERSION"
echo "$FINAL_DMG"
echo "$FINAL_ZIP"
