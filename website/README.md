# Static website

This directory contains a dependency-free product site for **Android File Transfer for macOS**. The repository-root `release-manifest.json` controls version, minimum macOS version, feature claims, and direct download names.

## Preview

From the repository root, build the deployable site and serve it:

```sh
node website/build.mjs
python3 -m http.server 4173 --directory website/dist
```

Then open `http://127.0.0.1:4173/`. The build copies every referenced image into `website/dist/assets`, so the output also works at the GitHub Pages project path.

`node website/build.mjs` rejects unresolved version tokens and any `data-feature` marked as available when the manifest does not say `shipped`. It does not prove that the app behavior passed hardware checks; release verification remains a separate gate.

## Publishing notes

- The Pages workflow deploys only after it confirms a published, non-prerelease release with all website download assets. Configure the repository's Pages source as GitHub Actions before running it.
- Re-run link, claim, responsive-layout, accessibility, and no-tracker checks before each release.
- The comparison inventory is a July 2026 research snapshot. The public UI omits prices and competitor OS minimums; refresh vendor capabilities before expanding it.
- Update the absolute canonical and Open Graph URLs if a custom domain replaces the default project Pages URL.

The site contains no analytics, cookies, remote fonts, client framework, package dependency, or third-party runtime request. Download links leave the site for GitHub Releases.
