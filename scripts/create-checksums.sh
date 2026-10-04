#!/usr/bin/env bash
set -euo pipefail

DIRECTORY="${1:?Usage: create-checksums.sh DIRECTORY}"
OUTPUT="$DIRECTORY/SHA256SUMS.txt"
rm -f "$OUTPUT"

find "$DIRECTORY" -maxdepth 1 -type f ! -name 'SHA256SUMS.txt' -print0 \
  | sort -z \
  | while IFS= read -r -d '' file; do
      checksum="$(shasum -a 256 "$file" | awk '{print $1}')"
      printf '%s  %s\n' "$checksum" "$(basename "$file")"
    done > "$OUTPUT"

echo "$OUTPUT"
