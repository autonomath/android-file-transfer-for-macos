#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIRECTORY="$(cd "${1:?Usage: verify-release-assets.sh ASSET_DIRECTORY [VERSION]}" && pwd)"
VERSION="${2:-$(node -p "require('$ROOT/package.json').version")}"

expected_assets="$(printf '%s\n' \
  "Android-File-Transfer-for-macOS-$VERSION-arm64.dmg" \
  "Android-File-Transfer-for-macOS-$VERSION-arm64.zip" \
  "Android-File-Transfer-for-macOS-$VERSION-x64.dmg" \
  "Android-File-Transfer-for-macOS-$VERSION-x64.zip" \
  "THIRD_PARTY_SOURCES-$VERSION.tar.gz" \
  'latest-mac.yml' \
  'SHA256SUMS.txt' | LC_ALL=C sort)"
actual_assets="$(find "$DIRECTORY" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
if [[ "$actual_assets" != "$expected_assets" ]]; then
  diff -u <(printf '%s\n' "$expected_assets") <(printf '%s\n' "$actual_assets") || true
  echo "Release asset set must contain exactly seven files" >&2
  exit 1
fi
test -z "$(find "$DIRECTORY" -mindepth 1 -maxdepth 1 ! -type f -print -quit)"

(cd "$DIRECTORY" && shasum -a 256 -c SHA256SUMS.txt)
node "$ROOT/scripts/write-update-manifest.mjs" verify "$DIRECTORY" "$VERSION"

for arch in arm64 x64; do
  for extension in dmg zip; do
    bash "$ROOT/scripts/verify-macos-release.sh" \
      "$DIRECTORY/Android-File-Transfer-for-macOS-$VERSION-$arch.$extension" \
      "$arch" "$VERSION"
  done
done

echo "Verified complete seven-file release set for $VERSION: $DIRECTORY"
