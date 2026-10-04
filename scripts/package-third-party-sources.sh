#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.1.0}"
CACHE_DIR="$ROOT/.cache/native-deps"
STAGE="$ROOT/.tmp/third-party-sources-$VERSION"
OUTPUT_DIR="${RELEASE_ASSET_DIR:-$ROOT/release/assets}"
OUTPUT="$OUTPUT_DIR/THIRD_PARTY_SOURCES-$VERSION.tar.gz"

mkdir -p "$CACHE_DIR" "$OUTPUT_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE"

download_and_verify() {
  local url="$1" destination="$2" expected="$3"
  if [[ ! -f "$destination" ]]; then
    curl --fail --location --retry 4 --retry-all-errors --output "$destination" "$url"
  fi
  [[ "$(shasum -a 256 "$destination" | awk '{print $1}')" == "$expected" ]]
}

download_and_verify \
  "https://github.com/libusb/libusb/releases/download/v1.0.30/libusb-1.0.30.tar.bz2" \
  "$CACHE_DIR/libusb-1.0.30.tar.bz2" \
  "fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf"
download_and_verify \
  "https://downloads.sourceforge.net/project/libmtp/libmtp/1.1.23/libmtp-1.1.23.tar.gz" \
  "$CACHE_DIR/libmtp-1.1.23.tar.gz" \
  "74a2b6e8cb4a0304e95b995496ea3ac644c29371649b892b856e22f12a0bdeed"

cp "$CACHE_DIR/libusb-1.0.30.tar.bz2" "$STAGE/"
cp "$CACHE_DIR/libmtp-1.1.23.tar.gz" "$STAGE/"
cp "$ROOT/scripts/build-native-deps.sh" "$STAGE/"
mkdir -p "$STAGE/patches"
cp "$ROOT/patches/libmtp-1.1.23-no-usb-reset.patch" "$STAGE/patches/"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/"
cp "$ROOT/ATTRIBUTION.md" "$STAGE/"
cp "$ROOT/licenses/LGPL-2.1.txt" "$STAGE/"

tar -czf "$OUTPUT" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"
echo "$OUTPUT"
