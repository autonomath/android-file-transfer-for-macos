# Android File Transfer for macOS v0.2.0

The second public release. It adds phone and Mac file management, explicit same-name conflict handling, and a connection flow that opens the phone on its own and explains clearly when it cannot. This version requires macOS 13 Ventura or newer.

## Added

- Rename phone files and folders, and permanently delete selected phone items after a native confirmation. Every rename and delete re-verifies the object's ID, storage, parent, kind, name, and size immediately before changing it.
- Create folders, rename items, and delete in the Mac pane. Mac delete moves items to the recoverable macOS Trash.
- Same-name transfers offer Keep Both, Replace, Skip Existing, or Cancel. Mac replacement is atomic; phone replacement uploads under a temporary name and keeps the old file under a backup name until the new one is verified.
- Independent list and grid views, hidden-file toggles, and selection summaries in each pane.
- Right-click context menus and shift-click range selection in both panes.
- A quiet daily check of the project's published GitHub Releases update manifest, plus Help > Check for Updates for an immediate answer. Download begins only after Update is chosen, and installation waits for an explicit restart choice.
- Automatic opening of one MTP session when File Transfer appears, reused for browsing and copying.
- Destination free-space checks before a copy to the Mac, and preserved phone modified dates on downloaded files and folders.

## Fixed

- The waiting screen no longer rewrites itself while the app rechecks the phone. A background recheck used to swap the heading between "Connected. Reading phone storage..." and "Waiting for your phone to share its files..." about twice a second.
- A phone left on Charging / No data transfer is now described accurately. Samsung devices still expose an MTP interface in that mode, so the session opens but no storage is ever shared; the app now says to choose File transfer instead of suggesting a prompt that never appears.
- The storage question is repeated at most every two seconds instead of on every 400 ms USB check, and repeated identical log lines are summarized every 30 seconds.
- When macOS camera import owns the phone, the app names a verified active client and keeps the USB-busy message stable. It waits for that client to release the phone instead of repeatedly terminating the camera daemon. No external processes are terminated automatically. An explicit normal-Quit action explains its effects and respects save prompts or refusal.

Both DMGs and their contained apps are Developer ID signed, Apple-notarized, stapled, and independently checked after upload. The signed apps in the updater ZIPs are checked to the same standard. Verify downloads with `SHA256SUMS.txt`.

The real-device checklist covers Samsung Galaxy S24-class and Pixel 9 USB scenarios. Complete transfer and file-management acceptance results for each model are still being recorded; reports from other Android devices and Mac configurations are especially useful.
