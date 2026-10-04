#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIRECTORY="${1:-$ROOT/release/assets}"
VERSION="${2:-$(node -p "require('$ROOT/package.json').version")}"
test "$VERSION" = "$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$DIRECTORY"
DIRECTORY="$(cd "$DIRECTORY" && pwd)"

for arch in arm64 x64; do
  for extension in dmg zip; do
    test -f "$DIRECTORY/Android-File-Transfer-for-macOS-$VERSION-$arch.$extension"
  done
done

RELEASE_ASSET_DIR="$DIRECTORY" bash "$ROOT/scripts/package-third-party-sources.sh" "$VERSION"
node "$ROOT/scripts/write-update-manifest.mjs" write "$DIRECTORY" "$VERSION"
bash "$ROOT/scripts/create-checksums.sh" "$DIRECTORY"
bash "$ROOT/scripts/verify-release-assets.sh" "$DIRECTORY" "$VERSION"
