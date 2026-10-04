#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-${TARGET_ARCH:-$(uname -m)}}"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}"
LIBUSB_VERSION="1.0.30"
LIBMTP_VERSION="1.1.23"
LIBMTP_PATCH="$ROOT/patches/libmtp-1.1.23-no-usb-reset.patch"
LIBUSB_SHA256="fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf"
LIBMTP_SHA256="74a2b6e8cb4a0304e95b995496ea3ac644c29371649b892b856e22f12a0bdeed"
CACHE_DIR="${NATIVE_DEPS_CACHE_DIR:-$ROOT/.cache/native-deps}"
WORK_DIR="$ROOT/.native-deps/build-$ARCH"
PREFIX="${NATIVE_DEPS_PREFIX:-$ROOT/.native-deps/$ARCH}"

case "$ARCH" in
  arm64) CLANG_ARCH="arm64" ;;
  x64|x86_64) ARCH="x64"; CLANG_ARCH="x86_64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac

mkdir -p "$CACHE_DIR" "$ROOT/.native-deps"
rm -rf "$WORK_DIR" "$PREFIX"
mkdir -p "$WORK_DIR" "$PREFIX"

download_and_verify() {
  local url="$1"
  local destination="$2"
  local expected="$3"

  if [[ ! -f "$destination" ]]; then
    curl --fail --location --retry 4 --retry-all-errors --output "$destination" "$url"
  fi

  local actual
  actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$destination"
    echo "Checksum mismatch for $(basename "$destination")" >&2
    exit 1
  fi
}

LIBUSB_ARCHIVE="$CACHE_DIR/libusb-$LIBUSB_VERSION.tar.bz2"
LIBMTP_ARCHIVE="$CACHE_DIR/libmtp-$LIBMTP_VERSION.tar.gz"
download_and_verify \
  "https://github.com/libusb/libusb/releases/download/v$LIBUSB_VERSION/libusb-$LIBUSB_VERSION.tar.bz2" \
  "$LIBUSB_ARCHIVE" \
  "$LIBUSB_SHA256"
download_and_verify \
  "https://downloads.sourceforge.net/project/libmtp/libmtp/$LIBMTP_VERSION/libmtp-$LIBMTP_VERSION.tar.gz" \
  "$LIBMTP_ARCHIVE" \
  "$LIBMTP_SHA256"

tar -xjf "$LIBUSB_ARCHIVE" -C "$WORK_DIR"
tar -xzf "$LIBMTP_ARCHIVE" -C "$WORK_DIR"

if [[ ! -f "$LIBMTP_PATCH" ]]; then
  echo "Required libmtp patch is missing: $LIBMTP_PATCH" >&2
  exit 1
fi
patch -d "$WORK_DIR/libmtp-$LIBMTP_VERSION" -p1 < "$LIBMTP_PATCH"

export MACOSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET"
export CFLAGS="${CFLAGS:-} -arch $CLANG_ARCH -mmacosx-version-min=$DEPLOYMENT_TARGET"
export CXXFLAGS="${CXXFLAGS:-} -arch $CLANG_ARCH -mmacosx-version-min=$DEPLOYMENT_TARGET"
export LDFLAGS="${LDFLAGS:-} -arch $CLANG_ARCH -mmacosx-version-min=$DEPLOYMENT_TARGET"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

configure_project() {
  if [[ "$(uname -m)" != "$CLANG_ARCH" ]]; then
    ./configure "--host=$CLANG_ARCH-apple-darwin" "$@"
  else
    ./configure "$@"
  fi
}

pushd "$WORK_DIR/libusb-$LIBUSB_VERSION" >/dev/null
configure_project \
  --prefix="$PREFIX" \
  --disable-static \
  --enable-shared
make -j"$(sysctl -n hw.logicalcpu)"
make install
popd >/dev/null

pushd "$WORK_DIR/libmtp-$LIBMTP_VERSION" >/dev/null
configure_project \
  --prefix="$PREFIX" \
  --disable-static \
  --enable-shared
make -j"$(sysctl -n hw.logicalcpu)"
make install
popd >/dev/null

echo "$PREFIX"
