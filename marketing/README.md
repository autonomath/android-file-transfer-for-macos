# Marketing and website bundle

This directory is the evidence-backed launch kit for **Android File Transfer for macOS**.

## What is here

- [`competitive-landscape.md`](competitive-landscape.md): category map, product comparison, research method, and source links.
- [`claims-ledger.md`](claims-ledger.md): the dated v0.1.0 evidence record and the release gate for v0.2.0 claims.
- [`technical-roadmap.md`](technical-roadmap.md): improvements ranked by user impact, risk, and strategic fit.
- [`messaging.md`](messaging.md): homepage copy, short descriptions, launch posts, FAQs, captions, and SEO metadata.
- [`assets/`](assets/): editable SVGs and rendered PNGs for social posts, comparison summaries, installation, privacy, and architecture.
- [`../website/`](../website/): dependency-free responsive website source.

## Research boundary

Research was refreshed on **2026-07-22**. It uses official product sites, App Store listings, vendor documentation, and first-party source repositories. Discovery searches were broader, but secondary comparison articles were not treated as proof of features. The filterable site inventory contains **45 named options** across direct USB, Finder, ADB, nearby sharing, OEM/suite, sync/cloud, and built-in workflows.

“All existing options” cannot literally include every white-label phone utility, generic FTP server, or new App Store clone. The inventory therefore covers:

1. Active, publicly discoverable Android-to-Mac USB/MTP file managers.
2. ADB-based Mac file managers and official developer tools.
3. Local-network, AirDrop/Quick Share, cloud, sync, and vendor alternatives that solve an adjacent user job.
4. Important discontinued, unsigned, source-only, or prototype options that users may still encounter.

Competitor capabilities are vendor-claimed unless explicitly described as independently tested. The dated comparison is research context, not publication-ready copy. Do not publish competitor prices, operating-system requirements, or availability from it without a fresh first-party check.

## Public-claim rule

At the 2026-07-22 audit, the downloadable release was **v0.1.0**, tagged at commit `e3add39`. The planned v0.2.0 launch copy is conditional: use the release manifest and completed handoff record in [`claims-ledger.md`](claims-ledger.md) to select the public feature list, macOS minimum, and download links. A source feature or locally built app alone does not make a public-release claim.

## Preview the website

From the repository root:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173/website/`.

No analytics, cookies, remote fonts, or third-party JavaScript are included.
