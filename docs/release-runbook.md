# macOS Release Runbook

The signed release workflow publishes only the exact commit identified by the workflow event's `GITHUB_SHA`. It checks out that SHA in every job, derives the release tag as `v<package.json version>`, and creates or validates that tag against the same source commit. Start the workflow from the commit that contains the intended version; do not change the version through workflow inputs. A local release uses the same asset preparation and verification scripts and likewise requires a clean checkout whose commit is already on GitHub.

## Required workflow inputs

- `signing_identity`: exact Developer ID Application identity reported by `security find-identity -v -p codesigning` after importing the release certificate.
- `csc_certificate_name`: certificate name that `electron-builder` must select from that imported keychain. The release script accepts the full `Developer ID Application: ...` identity or the name without that prefix.
- `team_id`: Apple Developer Team ID expected in every signed bundle component.

The `release` environment must provide `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. The certificate identity and `team_id` inputs must match the imported certificate. The workflow removes its temporary keychain after each matrix job.

## Local release requirements

`scripts/release-macos.sh arm64|x64` requires explicit `SIGNING_IDENTITY`, `CSC_CERTIFICATE_NAME`, and `EXPECTED_TEAM_ID`. It also requires one complete notarization method:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; or
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; or
- `APPLE_KEYCHAIN_PROFILE` and, when needed, `APPLE_KEYCHAIN`.

There is no implicit keychain profile. A local operator must select the profile and signing identity deliberately. The app's minimum supported macOS version comes from `package.json`; the release build, native libraries, and artifact verifier all use that value.

## Local release procedure

Commit and push the complete release source before starting. In a clean checkout at that exact commit, run `npm ci`, set the signing and notarization variables above, and build both architectures:

```sh
npm run release:mac -- arm64
npm run release:mac -- x64
bash scripts/prepare-release-assets.sh release/assets "$(node -p "require('./package.json').version")"
```

Use native Apple-silicon and Intel hosts for the respective smoke tests when available. Collect the two DMGs and two ZIPs into one `release/assets` directory before running `prepare-release-assets.sh`; each architecture's build copies both artifacts there. The prepare script adds the third-party source archive, computes one `latest-mac.yml` from both ZIPs, creates `SHA256SUMS.txt`, and checks the complete seven-file set. Clear old files from `release/assets` before starting a new version; unexpected files fail the gate.

After reviewing the seven assets and release notes, publish them with:

```sh
bash scripts/publish-macos-release.sh release/assets "$(node -p "require('./package.json').version")"
```

The publish script checks that `HEAD` is clean and available on GitHub, creates or updates a draft release bound to that SHA, downloads the assets from GitHub, reruns the complete verification gate, then publishes a normal release. If verification fails, the release stays in draft. A pre-existing published tag or a tag pointing to another commit stops the script.

## Release checks

The workflow builds and smoke-tests separate native Apple-silicon and Intel bundles. The release script checks the packaged helper, native addon, and app launch with time limits before submitting anything to Apple; an Intel build made on Apple silicon runs this smoke through Rosetta. Each architecture build then submits a temporary ZIP to Apple's notary service, staples the signed `.app`, and creates the updater ZIP from that stapled app. The temporary submission ZIP is deleted and is never published. It verifies each DMG and updater ZIP before upload and after downloading from GitHub: Developer ID signature, notarization and stapling, expected team ID, bundle version, macOS minimum version, Mach-O architecture/deployment target, hardened runtime, and the USB entitlement on `mtp-json`.

The published asset set must be exactly these seven files for the package version: two architecture-specific DMGs, two architecture-specific updater ZIPs, `latest-mac.yml`, `THIRD_PARTY_SOURCES-<version>.tar.gz`, and `SHA256SUMS.txt`. One manifest contains the SHA-512 and byte size of both ZIPs. The downloaded release is rejected if any asset is missing or added, a checksum changes, or the manifest differs from the ZIPs. Draft releases are not visible to the updater, so publication happens only after the downloaded set passes this gate.
