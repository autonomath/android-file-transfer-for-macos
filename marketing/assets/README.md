# Marketing visual bundle

All source files are hand-authored SVGs using only original, non-verbatim Android- and Mac-inspired character forms. No Google, Android robot, Apple, Finder, or AirDrop logo asset is embedded.

| Asset | Size | Intended use | Suggested alt text |
|---|---:|---|---|
| `og-card` | 1200×630 | Open Graph, link previews, release header | An original green phone character and blue Mac character exchange files over USB beside the project name. |
| `social-square` | 1080×1080 | Social feed post | Green phone and blue computer characters exchange a document over a physical cable above “Your cable should be enough.” |
| `how-it-works` | 1600×900 | Website, README, technical post | Five stages show USB visibility, File Transfer mode, file-session access, storage discovery, and lazy folder loading. |
| `privacy-local` | 1600×900 | Privacy explainer | File contents travel over USB between Android shared storage and a Mac folder; update checks fetch public GitHub release metadata without uploading phone content. |
| `architecture` | 1600×900 | Technical article, project page | React reaches Electron main through a context-isolated bridge, then a native MTP helper and pinned libmtp/libusb; AppKit handles Finder drags. |
| `comparison-summary` | 1600×900 | Comparison article, press kit | A guide matches browsing, wireless sending, Finder mounting, debugging, backup, and continuous sync with suitable tool categories. |
| `market-map` | 1600×900 | Market overview | Transfer options are placed from send-only to storage browsing, and from dependent to direct/local/accountless. |
| `website-preview.png` | 1440×1000 | Desktop QA/preview | Desktop homepage hero for Android File Transfer for macOS with download choices and the selected USB character artwork. |
| `website-mobile-preview.png` | 390×844 | Mobile QA/preview | Mobile homepage hero with navigation, release qualification, both architecture downloads, and the project graphic. |
| `visual-bundle-contact-sheet.png` | 1112×1370 | Internal review and bundle overview | Contact sheet showing the website preview and seven publication graphics. |

## Export

PNG exports should use the exact SVG dimensions. Example with ImageMagick:

```sh
magick -background none input.svg output.png
```

Retain the dated research qualifier on comparison graphics. The market map is a category-position diagram, not an independently benchmarked ranking.

## Usage rules

- The macOS 13+ promotional images are for the planned v0.2.0 launch; do not place them beside a v0.1.0 download. Publish them only after the v0.2.0 release handoff passes.
- Keep the architecture and USB/privacy diagrams version-neutral. Do not imply transfer resume, preview, a Finder mount, or universal device support.
- Regenerate paired PNGs whenever an SVG changes, including `og-card.png` used by the website's social preview.
- Do not call the UI fully native; it combines Electron/React with native C and AppKit components.
- Include the non-affiliation disclaimer in any page or press kit that uses these graphics.
