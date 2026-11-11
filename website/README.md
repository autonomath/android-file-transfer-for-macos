# Static website

This directory contains a short, static product page for **Android File Transfer for macOS**: downloads (DMG and Homebrew), one app screenshot, six feature highlights, three setup steps, a brief FAQ, and project links. The repository-root `release-manifest.json` controls version, minimum macOS version, feature claims, and direct download names.

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
- Keep the page short and stationary: no scroll effects, animations, moving controls, comparison tables, or roadmap. Feature highlights and FAQ answers stay to one or two sentences each. Background research remains in `marketing/`.
- Every feature card and any FAQ answer that describes app behavior carries a `data-feature` attribute so the build rejects claims the manifest does not mark `shipped`.
- Update the absolute canonical and Open Graph URLs if a custom domain replaces the default project Pages URL.

The site uses only HTML, CSS, and local images. It has no client JavaScript, analytics, cookies, remote fonts, or third-party runtime requests. It follows the visitor's light or dark system appearance. Images have explicit dimensions to reserve their space as they load. Download links leave the site for GitHub Releases.
