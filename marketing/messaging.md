# Messaging kit

Launch-copy draft updated **2026-09-27** for v0.2.0 and macOS 13+. Publish version-specific copy only after the signed release and the handoff in [claims-ledger.md](claims-ledger.md) pass. The underlying market comparison remains a **2026-07-22** snapshot; recheck any competitor fact before publication.

## Message hierarchy

### Name

**Android File Transfer for macOS**

The name is descriptive on purpose. Use the complete name in headings, metadata, download pages, and first references. “The app” is fine afterward.

### One-line position

Free and open-source USB file transfer between Android devices and macOS. No cloud, account, subscription, or companion app.

### Point of view

This is basic device interoperability. It should be built into macOS. Until it is, this project provides it.

### Proof, in order

1. Browse shared Android storage and copy files or folders in either direction over USB.
2. No Android app, developer mode, account, cloud storage, analytics, or subscription.
3. Both Apple-silicon and Intel DMGs are Developer ID signed, notarized, stapled, and checksum-published.
4. The source, build scripts, third-party notices, and exact libmtp/libusb sources are public.
5. The interface explains cable, File Transfer mode, MTP session, storage, and folder loading as separate states.

Do not lead with implementation details. Lead with the missing system utility, then use the release process and source availability as trust proof.

## Ready-to-use descriptions

### 55 characters

Open-source Android USB file transfer for macOS.

### 90 characters

Browse and copy Android files over USB on macOS. Free, open source, and local.

### 160-character description

Free, open-source USB file transfer between Android and macOS. Browse and copy files both ways—no cloud, account, subscription, or phone app.

### 50-word description

Android File Transfer for macOS is a free, open-source USB file manager for shared Android storage. Browse and copy files or folders in either direction without cloud storage, an account, a subscription, a companion phone app, or USB debugging. Official signed and notarized builds are provided separately for Apple silicon and Intel Macs.

### 100-word description

Android File Transfer for macOS fills a basic gap: macOS still does not provide general folder-level access to Android shared storage over USB. The app lets you browse the phone and Mac side by side, copy files and folders in either direction, drag phone files into Finder, and follow queued transfers with progress, speed, ETA, cancellation, and retry. It is free and open source, requires no account or Android companion, and keeps transfers on the cable. Separate Apple-silicon and Intel DMGs are Developer ID signed, Apple-notarized, stapled, and published with checksums and corresponding third-party source.

### 250-word project description

Android File Transfer for macOS is a focused, free, open-source utility for browsing shared Android storage and moving files over a USB cable. It exists because a basic folder-level Android file browser is still not built into macOS.

Connect and unlock a phone, select File Transfer or MTP, then browse Android storage and Mac folders side by side. Copy files and recursive folders in either direction, drag phone files into Finder, and follow queued progress, speed, ETA, cancellation, and retry. v0.2.0 adds phone rename and confirmed permanent delete, Mac rename and recoverable Trash, and explicit choices when a destination already has the same name. It does not mount the phone in Finder or resume interrupted transfers.

The app distinguishes a missing device from a USB-visible phone whose file session is not open. It gives specific guidance for USB mode, locked-phone prompts, protected MTP access, storage discovery, and slow folder listing instead of collapsing every failure into “device not found.”

There is no account, cloud file transfer, subscription, advertising, telemetry, companion Android app, or requirement to enable USB debugging. File contents stay on the USB path. A check for a newer version fetches public release metadata from GitHub; the app downloads an update only after the user chooses it. v0.2.0 supports macOS 13 or newer on Apple silicon and Intel. The official DMGs and contained apps are Developer ID signed, notarized, stapled, and independently rechecked; checksums and corresponding libmtp/libusb sources ship alongside them.

It remains an early release. Name compatible phone models only when the public matrix records an actual browse and copy result for the signed build; reports from other devices remain welcome.

## Homepage copy

### Eyebrow

THE USB FILE BROWSER macOS IS MISSING

### H1

Your Android files. On your Mac. Through the cable.

### Supporting paragraph

Browse shared Android storage and copy files or folders in either direction. Free and open source—without a cloud detour, phone app, developer mode, account, or subscription.

### Primary actions

- Download for Apple silicon
- Download for Intel
- View source on GitHub

### Release trust line

v0.2.0 · macOS 13+ · signed · notarized · stapled · checksums published

Use this line only after the public v0.2.0 artifacts pass the release handoff. Until then, the live download page must describe the actual published release.

### Market-context line

Quick Share and AirDrop now handle selected one-off sends on some newer Android phones. This app handles the other job: browsing and managing shared storage over USB.

## Honest comparison copy

### When this project is the right fit

Choose it when you want a cable, a visible folder tree, two-way file and folder copies, no Android installation, no developer mode, and auditable open-source packaging.

### When another option is better

- Use Quick Share/AirDrop or LocalSend for one-off wireless sends.
- Use a Finder-mount product when working directly inside Finder matters most; check the vendor's current feature and licensing terms.
- Use ADB or Android Studio when debugging is already enabled and developer-level filesystem access is the goal.
- Use Smart Switch or HiSuite for supported-device backup and migration.
- Use Syncthing or Resilio Sync for continuous replicated folders.

This candor is a product advantage. It makes the focused promise believable.

## FAQ copy

### Is this the old Google Android File Transfer app?

No. This is an independent open-source project. Google’s former `android.com/filetransfer` destination no longer distributes a Mac file browser. Android and macOS are trademarks of Google LLC and Apple Inc.; neither company endorses this project.

### Does it use Quick Share or AirDrop?

No. Those tools send selected items wirelessly. This app uses USB MTP so you can browse shared Android storage and work with folders. On supported newer phones, Quick Share/AirDrop may be the easier choice for a few files.

### Do I install anything on Android?

No. Unlock the phone and choose File Transfer, Transferring files, or MTP from its USB options.

### Do I need Developer Options or USB debugging?

No. The app uses Android’s normal MTP file-transfer mode, not ADB.

### Are files uploaded anywhere?

No. File contents move between the connected phone and Mac over USB. The app has no analytics or telemetry. Its update check fetches public release metadata from GitHub; it does not send phone files, filenames, or device identifiers.

### Is it really free?

Yes. The app is MIT-licensed. The bundled libmtp and libusb components remain under their upstream LGPL terms, with notices and corresponding source published for each release.

### Why are there two downloads?

Use `arm64` for Apple-silicon Macs and `x64` for Intel Macs. Separate artifacts keep each download architecture-specific and independently verifiable.

### Why might macOS ask for an administrator password?

On some Mac/phone combinations, macOS holds the USB interface behind protected device access. The app explains the request before invoking the system authorization dialog, and its helper drops back to the logged-in user before accepting file commands.

### Does it work with every Android phone?

The app is designed for devices that expose standard MTP/File Transfer storage, but Android behavior varies by phone and firmware. Check the published compatibility matrix for tested models and operations. Reports from other phones and MTP devices are especially useful.

### Is the app signed?

Official releases are signed and notarized. For each release, check the published SHA-256 file and release notes for the exact artifacts that passed post-upload signature, staple, and Gatekeeper verification.

## Launch-post drafts

These are v0.2.0 templates, not announcements of a published release. Use them only after the release handoff is complete; remove any feature whose test gate did not pass and link the final device matrix rather than asserting blanket compatibility.

### GitHub release / repository announcement

Android File Transfer for macOS v0.2.0 is available for macOS 13+.

It is a free, open-source USB file browser for shared Android storage: two-way file and folder copy, Finder drag and drop, a visible transfer queue, and specific connection diagnostics. This release adds phone rename and confirmed permanent delete, Mac rename and Trash, and clear choices for same-name transfers. No account, cloud file transfer, subscription, companion Android app, analytics, or USB debugging.

The Apple-silicon and Intel DMGs are Developer ID signed, notarized, stapled, and checksum-published. The app checks GitHub for release metadata and downloads an update only when you choose to. This remains an early release; the compatibility matrix lists the devices and operations actually tested, and more reports are welcome.

This is basic device interoperability. It should be built into macOS. Until it is, this project provides it.

### Hacker News

**Show HN: Android File Transfer for macOS — open-source, local USB/MTP utility**

I wanted the boring system utility that should already exist: plug in an Android phone, browse shared storage, and copy files both ways without an account, cloud service, subscription, Android companion, or enabling USB debugging.

The app is Electron/React on top of a small native libmtp helper. Folder browsing is lazy rather than a full-device scan. Phone-to-Finder drag uses AppKit file promises, so USB transfer starts only after Finder accepts a destination. The connection UI separates USB visibility, MTP session, storage, and folder listing because “device detected” is not the same as “files are open.”

v0.2.0 has signed/notarized/stapled arm64 and x64 DMGs for macOS 13+, checksums, published native dependency sources, and a consent-based updater. It adds explicit collision choices and file-management actions. It is early; the published compatibility matrix shows which devices and operations have actually been tested.

### Reddit / community post

I released a free, open-source Android USB file browser for macOS.

It browses the phone and Mac side by side, copies files or folders both ways, supports Finder drag and drop, and shows real transfer progress. It does not need an Android app, an account, Wi-Fi, cloud storage, a subscription, or USB debugging.

Both Mac builds are signed and notarized for macOS 13+. v0.2.0 adds rename, delete, and same-name transfer choices. It is still early, so I would especially appreciate reports from devices and Mac versions beyond those in the published compatibility matrix.

### Short social post

Android ↔ Mac file transfer should be a system feature.

Until it is: a free, open-source USB file browser for macOS 13+. No cloud file transfer, account, subscription, phone app, telemetry, or developer mode. Signed and notarized for Apple silicon and Intel.

## Screenshot captions and alt text

### Main product screenshot

Caption: Browse Android storage and Mac folders side by side, with connection stages and transfer controls visible in one window.

Alt: Android File Transfer for macOS showing Samsung shared storage on the left, a Mac folder on the right, and completed cable, file-transfer, session, storage, and folder-list connection stages.

### Project graphic

Caption: Direct, two-way USB file transfer between Android devices and macOS.

Alt: A green Android-inspired character and blue Mac-inspired computer exchange document icons through a physical USB cable.

## SEO metadata

### Title

Android File Transfer for macOS — Free Open-Source USB File Browser

### Meta description

Browse and copy Android files on macOS over USB. Free and open source, with no cloud, account, subscription, phone app, or USB debugging.

### Search themes

- Android file transfer Mac
- Android USB file transfer macOS
- MTP Mac
- browse Android files on Mac
- Samsung file transfer Mac
- Pixel file transfer Mac
- open source Android file transfer
- Android File Transfer alternative macOS

Do not stuff all phrases into body copy. Use device-specific phrases only in truthful compatibility/help pages that acknowledge device variance.

## Language rules

- Say **Apple silicon**, not “M1/M2/M3 only.”
- Say **Intel**, not “older Mac,” in download controls.
- Say **shared Android storage**, not “the full Android filesystem.” MTP does not expose protected app/system data.
- Say **copy** unless the UI performs and verifies an actual source deletion.
- Say **local over USB**, not “air-gapped.” The Mac itself may still be online.
- Say **no companion Android app** rather than “nothing installed,” because the Mac app is installed.
- Never claim “fastest,” “universal device support,” “zero risk,” or “the only alternative.”
- Keep **early release** and the real-device testing boundary close to download claims. Only call a release a pre-release if GitHub marks it as one.

## Non-affiliation line

Android is a trademark of Google LLC. macOS is a trademark of Apple Inc. This independent project is not affiliated with or endorsed by Google or Apple.
