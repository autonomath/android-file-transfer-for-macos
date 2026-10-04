# Public claims ledger

Historical audit date: **2026-07-22**. v0.2.0 launch gate added **2026-09-27**.

The v0.1.0 tables below record what was public at the audit date; they are retained as historical evidence. The release-specific handoff below governs new website, README, screenshot, launch-post, and comparison claims. A feature in source is not a shipped feature until the matching signed public artifacts are verified.

## v0.2.0 launch gate

The planned v0.2.0 build targets **macOS 13+** on Apple silicon and Intel. This deliberately drops macOS 12 for the new release; v0.1.0's macOS 12 target remains a fact about that older artifact. The build's final minimum must match its packaged metadata and every bundled Mach-O deployment target.

| Planned claim | Publish only after |
| --- | --- |
| v0.2.0 is available, signed, notarized, and Gatekeeper accepted | Both public DMGs are downloaded again and independently pass the release verifier, checksum, signature, staple, architecture, and macOS 13 target checks |
| Phone rename, permanent phone delete, Mac rename/Trash, and same-name Keep Both/Replace/Skip/Cancel | The exact behaviors pass contracts and disposable-data hardware tests, including refusal, disconnection, and partial failure on the device families claimed |
| Consent-based in-app updates | Both architecture ZIPs and the merged `latest-mac.yml` are public and verified; an installed v0.2.0 build proves that no download starts before a click and no install occurs on ordinary quit |
| Samsung or Pixel compatibility | A dated record for each named model includes Android/macOS versions, architecture, signed build, and actual browse plus bidirectional copy results; a USB-detection procedure alone is insufficient |
| Public compatibility matrix | Every listed device and operation has a corresponding test record; report untested combinations as unknown |

Before publishing launch copy, complete the release-to-marketing handoff record at the end of this file and check the versioned release manifest. If a gate fails, remove that claim from the site and release announcement; never infer it from the roadmap. Do not publish exact competitor prices from the July research snapshot.

## Version boundary

| Layer | Revision/state | What it means for public copy |
| --- | --- | --- |
| Downloadable public release | v0.1.0; release source `e3add3913a6500b4f3ed3ab7f7e35857bd24482b`; published as an early pre-release | This is the default truth for all product claims and screenshots attached to a v0.1.0 download |
| Committed `main` | `1c6dfa2` at audit time | Adds an updated connected-phone screenshot and branded development-app packaging; it does **not** authorize advertising the dirty worktree's new file-management features as shipped |
| Local working tree | Modified/untracked files on top of `1c6dfa2` | Development evidence only. Nothing in this layer is publicly shipped until reviewed, committed, built, signed, notarized, published under a new version, and revalidated after download |
| Marketing bundle | Untracked/new files under `marketing/` and the planned `website/` | May describe v0.1.0 accurately and may label future work. It cannot redefine the release |

Public release: [GitHub v0.1.0](https://github.com/autonomath/android-file-transfer-for-macos/releases/tag/v0.1.0)<br>
Release-source README: `git show e3add39:README.md`<br>
Release notes: `git show e3add39:docs/release-notes-v0.1.0.md`

## Evidence hierarchy

Use the strongest available evidence, in this order:

1. A re-downloaded public artifact that passed checksum, signature, notarization-staple, Gatekeeper, architecture, deployment-target, and behavior verification.
2. The exact source commit bound to that artifact and its automated-contract results.
3. A documented real-device test with device model, Android version, Mac model/architecture, macOS version, cable/topology, and test build hash.
4. Code or a contract test in the local worktree.
5. A design, roadmap, issue, or README draft.

Levels 4 and 5 are not evidence that a downloadable feature shipped. A passing synthetic contract is useful engineering evidence but does not replace an MTP hardware test.

## v0.1.0 claim-by-claim ledger

### Identity, distribution, and support

| Claim | Status | Evidence | Required wording/qualification |
| --- | --- | --- | --- |
| Product name is “Android File Transfer for macOS” | Public/shipped | `e3add39:package.json`, bundle metadata, release artifacts | Keep the non-affiliation notice because Android and macOS are third-party trademarks |
| App package is free and open-source | Public/shipped | MIT `LICENSE`; public repository; `package.json` | The application source is MIT. Bundled libmtp/libusb are LGPL-2.1-or-later and have separate notices/source obligations |
| No subscription | Public/shipped | No payment/licensing system in release source | Safe for this project; do not use it to imply every paid competitor is abusive |
| macOS 12+ | Public binary target | `minimumSystemVersion: 12.0`; Mach-O deployment checks; README | Say “binary compatibility target” or “supports macOS 12+”; also say the release is early and asks for broader OS/device testing |
| Apple silicon and Intel downloads | Public/shipped | Separate `arm64` and `x64` DMGs and release verification | Keep architecture chooser visible; do not call either DMG universal |
| The app and DMGs are Developer ID signed, Apple-notarized, stapled, and Gatekeeper-verified | Public/shipped for the two v0.1.0 DMGs | Release workflow, `verify-macos-release.sh`, public release notes, post-upload revalidation | Bind this claim specifically to official v0.1.0 assets; never infer it for local/dev/source builds |
| Early pre-release | Public/shipped status | GitHub release metadata and release notes | Keep “early” or “pre-release” close to download CTAs |
| Deepest hardware validation is Samsung | Public/shipped disclosure | Release notes/manual checklist and real-device work | Say broader device/OS reports are wanted; do not generalize Samsung results to all Android devices |

Official v0.1.0 artifact names:

- `Android-File-Transfer-for-macOS-0.1.0-arm64.dmg`
- `Android-File-Transfer-for-macOS-0.1.0-x64.dmg`
- `THIRD_PARTY_SOURCES-0.1.0.tar.gz`
- `SHA256SUMS.txt`

No ZIP, blockmap, or auto-updater metadata is part of the intended public release set.

On 2026-07-22, all four public assets were downloaded again from GitHub. `SHA256SUMS.txt` verified both DMGs and the third-party source archive. For each architecture, the release verifier confirmed the DMG signature, notarization ticket, staple, Gatekeeper acceptance, contained app's deep/strict signature, app staple and Gatekeeper acceptance, expected TeamIdentifier, hardened runtime, MTP-helper USB entitlement, nested helper/addon/library signatures, 19 architecture-correct Mach-O files, and a maximum deployment target of macOS 12.0. This revalidation proves artifact integrity and binary targeting; it is not a substitute for broader real-device behavior testing.

### Transfer and browser behavior

| Claim | Status | Evidence in release source | Honest boundary |
| --- | --- | --- | --- |
| Browse Android shared storage over USB MTP | Public/shipped | README, `src/native/mtp-json.c`, main/preload/renderer, connection contracts | Android must expose File Transfer/MTP and grant access; availability varies by device/cable/state |
| Browse Mac folders in a second pane | Public/shipped | README/manual checklist; renderer/main local-pane code | v0.1.0 is an app pane, not a Finder mount |
| Copy files and folders phone→Mac | Public/shipped | Download/folder-planning/atomic-download contracts and manual checklist | Folder copy is recursive; do not claim synchronization or interruption resume |
| Copy files and folders Mac→phone | Public/shipped | Upload/folder-copy contracts and manual checklist | MTP device may reject writes or names; no general overwrite in v0.1.0 |
| Finder drag and drop | Public/shipped | Drag contract; native `file-promise-drag.node`; manual checklist | Phone→Finder uses file promises. Do not say the phone is mounted in Finder |
| Transfer queue with progress, speed, ETA, cancel, retry | Public/shipped | Queue contracts/README/manual checklist | Retry starts a new attempt; it is not byte-range resume |
| Folder-copy planning can be stopped before jobs queue | Public/shipped | Folder planning contract and README | “Stop planning” is not pause/resume of an active payload |
| Files over 4 GB are supported | Public/shipped design/behavior | Idle-timeout implementation, contract, README, manual large-file smoke | Phrase as “supports 4GB+ transfers while progress continues,” not “any size on every phone/filesystem” |
| Mac downloads are atomically published and do not overwrite | Public/shipped | `atomicDownload.ts`, atomic/conflict contracts | Applies to v0.1.0 phone→Mac download path; do not convert into a general filesystem durability guarantee |
| Checks destination-volume free space | Public/shipped | Download-space contract and README | It checks the selected destination volume; storage can still change during a transfer |
| Preserves modified dates | Public/shipped | Download/folder timestamp contracts | Say “preserves available phone modified dates for downloaded files/folders,” not all metadata, permissions, extended attributes, or creation dates |
| Handles same-name Mac destinations without overwriting | Public/shipped | Download-conflict/atomic contracts | v0.1.0 uses conflict-safe naming. The richer Keep Both/Replace/Skip/Cancel workflow is unreleased |
| Multiple connected phones | Public/shipped | Device-selection/identity contracts, README | Device indices are routed by physical connection identity; broad multi-vendor hardware testing remains pending |
| List and grid phone views | Public/shipped | View-mode contract, README/manual checklist | Do not claim both panes have independent grid view in v0.1.0; that is local/unreleased work |
| Sorting, range selection, context menus, keyboard actions, hidden-file toggle | Public/shipped | Individual contract scripts and manual checklist | Hidden files are hidden by default; do not describe untested accessibility behavior |
| Create a folder on the phone | Public/shipped | Native `mkdir`, upload contracts/manual checklist | Requires a writable MTP parent/storage |
| Move a file between phone and Mac | Public/shipped with strict limit | Move contract, release README/manual checklist | File-only. Copy and verify first, then delete the exact source. No folder Move |
| General phone rename/delete | **Not in public v0.1.0** | Release README explicitly excludes it | Must not appear in v0.1.0 feature lists, product screenshots, or comparison checkmarks |
| General overwrite/replace | **Not in public v0.1.0** | Release README explicitly excludes overwrite | Conflict-safe new naming is shipped; explicit staged replacement is local/unreleased |
| Finder mounting | Not implemented | Architecture and UI | Say “Finder drag and drop,” never “mounts in Finder” or “native Finder drive” |
| Transfer resume | Not implemented | Queue behavior | Cancel/retry is not pause/resume or checkpoint recovery |
| Folder synchronization/backup | Not implemented | Product scope | Recursive copy is not sync, mirroring, backup, version history, or restore |

### Connection handling and diagnostics

| Claim | Status | Evidence | Honest boundary |
| --- | --- | --- | --- |
| Distinguishes no device, USB-visible/session-not-open, storage, and folder-listing states | Public/shipped | Connection-state contracts, README, architecture | Do not collapse these into “connected” in screenshots or support copy |
| Lazy folder browsing | Public/shipped | Architecture, native `list`, folder-listing contracts | A Samsung fallback may create/cached-index behavior when storage metadata is incomplete |
| Persistent MTP session | Public/shipped | Architecture/main/native helper | The worker can be reopened after cancellation/failure; not a guarantee that every phone keeps sessions stable |
| Guidance for phone lock/Android Allow prompt | Public/shipped | Connection-state contracts/manual checklist | Exact Android wording varies by manufacturer/version |
| Protected “Open files” recovery path can explain a macOS password prompt | Public/shipped | Architecture/protected-inventory tests/manual checklist | State why permission is requested. Never imply the whole app runs as root; the helper must drop privileges before file commands |
| Copy Report is privacy-bounded | Public/shipped | Diagnostics contract and README | Users still decide whether to paste a report publicly; continuously test redaction against new fields |
| No white-window startup failure | Public mitigation | Startup fallback contract/README | Say static startup/crash fallbacks exist, not that a renderer can never crash |

### Privacy and network behavior

| Claim | Status | Evidence | Honest boundary |
| --- | --- | --- | --- |
| No account or Android companion app | Public/shipped | Release architecture/dependencies/README | Required macOS app plus Android's built-in MTP mode is the workflow |
| No cloud file transfer | Public/shipped | Release source and architecture | “File payload stays between phone and Mac” is safe; signing/notarization/download obviously use internet outside transfer time |
| No telemetry, analytics, or advertising | Public/shipped | Release source/dependencies and README | Keep dependency review and network observation in release gates; avoid broader claims about GitHub or Apple download infrastructure |
| Works without Wi-Fi/internet for file transfer | Public/shipped | USB MTP architecture | The app must already be installed; downloading it and filing issues require network access |
| No update network request | True for v0.1.0 | Release source has no current local update-check implementation | Do not make this a permanent product promise: an explicit, privacy-bounded GitHub Releases update check is local/unreleased |

## Committed `main` after v0.1.0

Only two committed deltas existed after the release source at audit time:

| Commit | Change | Public claim impact |
| --- | --- | --- |
| `dcd31df` | Updated `docs/screenshot.png` with the connected-phone view | New visual evidence can be used if it does not expose private device/file information and accurately reflects v0.1.0 behavior |
| `1c6dfa2` | Branded the development Electron app bundle; added `scripts/run-dev.sh` and package-icon checks | Development quality improvement. It does not add a downloadable end-user feature and is not a new release |

Therefore the website must continue to use the v0.1.0 product ledger even when served from current `main`.

## Local/unreleased capability ledger

The following work was present only as modified or untracked files at the 2026-07-22 audit. It may be discussed in a clearly labeled roadmap or development log. It may not receive a “shipped,” “available,” or v0.1.0 comparison checkmark.

| Local capability | Evidence paths | Required before public claim |
| --- | --- | --- |
| General phone file/folder rename | `src/shared/phoneMutation.ts`, `src/native/mtp-json.c`, renderer/main/preload changes, `scripts/check-phone-mutations.mjs` | Sanitize fixtures; review protocol/identity checks; real-device success/failure matrix; full signed release |
| Permanent phone delete with native confirmation and stale-object verification | Same phone-mutation paths | Destructive tests only on synthetic/disposable data across vendors; partial-failure UX; signed release |
| Mac-pane create, rename, and Trash deletion | `src/shared/localMutation.ts`, renderer/main/preload changes, `scripts/check-local-mutations.mjs` | Symlink/race/sandbox review; Trash recovery test; accessibility and signed release |
| Independent list/grid and hidden-file state per pane | Renderer/style/type changes and view/hidden/local contracts | UI regression/keyboard/VoiceOver tests; committed release |
| Keep Both, Replace, Skip Existing, Cancel collision choices | `src/shared/transferCollision.ts`, `src/main/phoneReplacement.ts`, `scripts/check-transfer-collisions.mjs`, modified atomic/upload checks | Real-device replacement interruption tests; verify backup cleanup and no data loss; signed release |
| Identity-bound Mac upload descriptor | Native helper/main/type changes | Race/fault tests; external review of `O_NOFOLLOW`/`fstat` assumptions; signed release |
| Quiet daily and explicit GitHub Releases update checks | `src/shared/appUpdate.ts`, main/renderer/menu changes, `scripts/check-app-updates.mjs` | Privacy text, offline/error behavior, version/channel tests, explicit release decision |
| Scoped handling when Apple's `ptpcamerad` exclusively owns the selected MTP interface | `src/main/macMtpCamera.ts`, main changes, `scripts/check-mac-mtp-camera-owner.mjs` | Synthetic fixture is now in place; prove owner/UID/device scoping, test that unrelated processes are untouched, full review/release |
| Stronger session teardown serialization | Main/native changes and `scripts/check-session-teardown-queue.mjs` | Stress/fault/device tests and packaged verification |
| Hardened packaged-host/native-addon smoke check | `scripts/smoke-current-package.mjs`, packaging/release script changes | Run natively on both runner architectures with Developer ID credentials and published artifacts |
| Next-release workflow hardening and provenance binding | Modified `.github/workflows/release.yml`, release/verify scripts, `docs/release-runbook.md` | Commit/review, exercise with live release environment, post-upload revalidation, publish only on all green gates |
| New app icon and project graphic | `build/app-icon.*`, `docs/project-graphic.*` | Check source/license/originality, all rendered sizes, dark/light contexts, privacy-safe screenshots; release/site integration |

### Resolved source-hygiene finding

During this audit, `npm run check:public-source` caught a real device identifier in a local unreleased check fixture. The identifier is intentionally not reproduced here. It was replaced with syntactically representative synthetic fixtures, the parser check passed, and `npm run check:public-source` then passed on 2026-07-22.

Before any commit, PR, public website source bundle, or release:

1. Keep all device identifiers and personal names in fixtures synthetic.
2. Scan the entire staged set, Git objects intended for publication, generated site output, screenshots, reports, and archives.
3. Re-run `npm run check:public-source` and review its staged-file/nested-repository/secret/large-file results.
4. Confirm no personal filenames, phone serials, copied phone content, private logs, or local reference repositories are in the publication set.

The immediate fixture leak is resolved. Keeping the scan green on the exact publication set remains a hard gate, not a documentation caveat.

## Approved public copy for v0.1.0

### One line

> Free and open-source USB file transfer between Android devices and macOS. No cloud, account, subscription, or companion app.

### More descriptive line

> Browse Android shared storage and copy files or folders in either direction over USB MTP—without Wi-Fi setup or USB debugging.

### Distribution line

> v0.1.0 is an early pre-release for macOS 12+. Separate Apple-silicon and Intel DMGs are Developer ID signed, Apple-notarized, stapled, and checksum-verified.

### Privacy line

> File payloads travel directly between the connected Android device and Mac. v0.1.0 has no account, cloud file transfer, telemetry, analytics, or advertising.

### Scope line

> It is a direct USB browser and transfer utility—not a wireless sender, cloud sync service, phone backup suite, or Finder-mounted drive.

### Testing line

> The release's deepest real-device validation is with Samsung MTP behavior. Reports from other Android devices, Macs, and macOS versions are especially valuable.

## Claims allowed only with qualification

| Tempting shorthand | Publish this instead |
| --- | --- |
| “Works on macOS 12+” | “Built for macOS 12+ on Apple silicon and Intel; this early release needs broader device/OS testing.” |
| “Private” | “No account, telemetry, cloud file transfer, or companion app in v0.1.0; payloads use the USB connection.” |
| “Offline” | “File transfer itself needs no internet or Wi-Fi.” |
| “Large files” | “Supports 4GB+ transfers while progress continues; device/filesystem limits can still apply.” |
| “Preserves metadata” | “Preserves available modified dates on downloaded files and copied folders.” |
| “Safe Move” | “For files only, copies and verifies the destination before deleting the exact source; the source is kept on failure.” |
| “Multi-device” | “Supports multiple connected MTP phones in the app; broader hardware validation is ongoing.” |
| “Native Mac drag and drop” | “Uses a native AppKit file-promise bridge for phone-to-Finder drag and drop.” |
| “Signed download” | “Official v0.1.0 DMGs and contained apps are Developer ID signed, notarized, stapled, and revalidated.” |
| “No Google alternative” | “Google now supports Quick Share↔AirDrop on selected Android phones; this project instead provides a browsable USB storage workflow.” |

## Prohibited or unsupported claims

Do not publish any of the following for v0.1.0:

- “Works with every Android device,” “universal compatibility,” or a manufacturer logo wall that implies certification.
- “The only,” “the first,” or “the only open-source” Android-to-Mac transfer app.
- “Fastest,” “more reliable,” “safer,” or “more private” than named competitors without a current, controlled, reproducible comparison.
- “Built into macOS,” “system extension,” “native Finder mount,” or “Android drive in Finder.” The desired public-interest position is that this capability *should* be basic OS interoperability; the actual product remains a separate app.
- “Native macOS app” without explanation. The UI is Electron/React; native C/Objective-C helpers handle MTP and AppKit integration.
- “No network activity ever.” Future update checks are under development, and distribution/support infrastructure uses networks.
- “End-to-end encrypted.” USB-local transport and absence of cloud do not establish an application-layer E2EE protocol.
- “Zero data loss,” “unbreakable,” “secure by design,” or “cannot overwrite.” State the exact atomic/non-overwrite behavior and its scope.
- “Resume,” “pause,” “sync,” “mirror,” “backup,” “restore,” “version history,” “Quick Look,” or “thumbnail preview.”
- “Rename and delete phone files,” “replace existing,” “independent grid views,” “Mac Trash,” or “automatic update checks.” These are local/unreleased at the audit boundary.
- “Supports internal storage and every SD card” without device-specific evidence. MTP storage reporting varies.
- Any live price, version, device-support, or OS claim about a competitor copied from a dated research snapshot without rechecking its first-party source.

## Claim review workflow

Before a public site build or release announcement:

1. Set the marketed version in one place.
2. Bind the claim ledger to the exact source commit and release asset set.
3. Diff the website's feature bullets and comparison data against this ledger.
4. Reject any shipped checkmark whose evidence is only an uncommitted file, test, design, or roadmap.
5. Run the public-source scan and inspect its output manually.
6. Validate download URLs, artifact names, checksums, signing, stapling, Gatekeeper, architecture, and deployment target from freshly downloaded files.
7. Recheck volatile competitor sources and timestamp the comparison.
8. Review every screenshot for real identifiers, personal paths/names, notifications, window titles, and inconsistent product state.
9. Run accessibility and responsive-layout checks so qualifications remain visible on mobile.
10. Have one person review the page as a skeptical user: can any sentence be read as promising more than the release delivers?

## Release-to-marketing handoff record

Create one record per release with:

```text
version:
source commit:
release URL:
publication date:
artifact names:
SHA-256 verification:
Developer ID TeamIdentifier verification:
notarization/stapler verification:
Gatekeeper verification:
arm64 behavior smoke:
x64 behavior smoke:
real-device matrix URL:
approved claims-ledger revision:
known limitations:
reviewer:
```

Until that record is complete, a new version can appear in a roadmap or development log but must not replace the v0.1.0 download claims.
