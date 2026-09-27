#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIRECTORY="$(cd "${1:?Usage: publish-macos-release.sh ASSET_DIRECTORY [VERSION]}" && pwd)"
cd "$ROOT"
VERSION="${2:-$(node -p "require('$ROOT/package.json').version")}"
TAG="v$VERSION"
SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
test "$VERSION" = "$(node -p "require('$ROOT/package.json').version")"
test -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)"

# The release must be bound to a commit already available on GitHub.
gh api "repos/{owner}/{repo}/commits/$SOURCE_SHA" --silent
bash "$ROOT/scripts/verify-release-assets.sh" "$DIRECTORY" "$VERSION"

if git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  git -C "$ROOT" fetch --force origin "refs/tags/$TAG:refs/tags/$TAG"
  test "$(git -C "$ROOT" rev-list -n 1 "$TAG")" = "$SOURCE_SHA"
else
  if git -C "$ROOT" show-ref --verify --quiet "refs/tags/$TAG"; then
    test "$(git -C "$ROOT" rev-list -n 1 "$TAG")" = "$SOURCE_SHA"
  else
    git -C "$ROOT" tag "$TAG" "$SOURCE_SHA"
  fi
  git -C "$ROOT" push origin "refs/tags/$TAG"
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  test "$(gh release view "$TAG" --json isDraft --jq .isDraft)" = true
  gh release upload "$TAG" "$DIRECTORY"/* --clobber
else
  NOTES_FILE="$ROOT/docs/release-notes-v$VERSION.md"
  if [[ -f "$NOTES_FILE" ]]; then
    gh release create "$TAG" "$DIRECTORY"/* --draft --target "$SOURCE_SHA" --title "$TAG" --notes-file "$NOTES_FILE"
  else
    gh release create "$TAG" "$DIRECTORY"/* --draft --target "$SOURCE_SHA" --title "$TAG" --generate-notes
  fi
fi

git -C "$ROOT" fetch --force origin "refs/tags/$TAG:refs/tags/$TAG"
test "$(git -C "$ROOT" rev-list -n 1 "$TAG")" = "$SOURCE_SHA"

DOWNLOAD_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/android-file-transfer-release-download.XXXXXX")"
trap 'rm -rf "$DOWNLOAD_DIRECTORY"' EXIT
gh release download "$TAG" --dir "$DOWNLOAD_DIRECTORY"
bash "$ROOT/scripts/verify-release-assets.sh" "$DOWNLOAD_DIRECTORY" "$VERSION"
gh release edit "$TAG" --draft=false --prerelease=false
echo "Published verified $TAG from $SOURCE_SHA"
