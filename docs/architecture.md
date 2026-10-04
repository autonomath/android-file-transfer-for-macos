# Architecture

## Overview

Android File Transfer for macOS is an Electron desktop app with three layers:

- Renderer: React UI for device state, dense file browsing, destination selection, and transfer queue visibility.
- Main process: Electron IPC, folder picker, Finder reveal, logging, and sequential transfer queue control.
- Native helper: `resources/bin/mtp-json`, compiled from `src/native/mtp-json.c`, using libmtp.

## MTP Bridge

The native helper exposes one-shot diagnostic commands plus a long-lived session command:

```sh
mtp-json status
mtp-json inventory
mtp-json list <device-index> <storage-id> <parent-id>
mtp-json download <device-index> <object-id> <destination-path>
mtp-json mkdir <device-index> <storage-id> <parent-id> <folder-name>
mtp-json upload <device-index> <storage-id> <parent-id> <source-path>
mtp-json session <device-index>
```

`status` runs libmtp raw device detection and returns a JSON state such as `no-device`, `connect-error`, or `connected`.

The Electron app uses `session` for normal work. The helper opens one libmtp device session, then accepts stdin commands for inventory, folder listing, and download. This avoids reopening the Samsung/macOS MTP session between browse and copy operations. When the main process closes an idle normal session, it sends the helper's `quit` command first so the helper can call `LIBMTP_Release_Device`; forced `SIGTERM`/`SIGKILL` is only a fallback for a stuck open, timeout, or canceled active transfer.

Before opening a session on macOS, the main process inspects the selected phone's MTP interface in IOKit. A matching serial is required when the selected phone has one. When `ptpcamerad` owns that interface, log records are limited to that daemon's lifetime, PID, and a single matching USB location, and each named client is checked against a currently running, same-user executable. Client-release records invalidate earlier registrations. Logs from previous daemon processes or other USB locations cannot name the blocking app. Google Drive has a readable display name instead of its internal `drivefs` identifier. Observed ownership raises a typed USB-busy error so user-facing wording and stale helper errors cannot turn it into a phone timeout or disable passive retries.

USB conflict detection is read-only. It never terminates another app or the camera-import daemon, including when the client cannot be identified. Automatic ownership checks continue every five seconds; USB mode checks remain at 400 milliseconds. The conflict panel explains that nothing closes automatically, defaults to Keep waiting, and offers a separate Request <app> to quit action only for verified clients. It describes the impact on synchronization, cloud-only files, imports, and unsaved work before that action.

A Quit request carries only an opaque offer ID and USB connection ID from the renderer. The main process rechecks the attachment, owning daemon, client PID, and executable path. The native addon selects one running application with the expected bundle ID and bundle path and calls macOS `NSRunningApplication.terminate`, a normal Quit request. It never calls `forceTerminate`, sends a termination signal to that app, or escalates after a refusal. Delivery is reported as "Quit requested", not "app closed"; save dialogs and refusals are respected. The normal connection watcher resumes when the interface becomes available. Unknown owners receive guidance without an app-closing action. Cancel and a changed attachment invalidate pending connection attempts.

A camera-service request in the unified log is evidence of a client, not proof that the client reset the physical USB connection. USB ownership, session-open results, storage enumeration, and actual file reads are checked separately.


The one-shot `inventory` command remains useful for diagnostics. Inventory reads storage metadata only. It does not recursively walk the full phone, because large Samsung-class media libraries can make a whole-device scan too slow for startup.

Folder contents are loaded on demand with:

```sh
mtp-json list <device-index> <storage-id> <parent-id>
```

`list` calls `LIBMTP_Get_Files_And_Folders` for one storage/folder and emits JSON objects with:

- object ID
- parent ID
- storage ID
- name
- kind
- size
- modified timestamp
- libmtp filetype

Storage-root navigation uses libmtp's root parent ID `0xffffffff`.

`download` calls `LIBMTP_Get_File_To_File` for one object ID and emits newline-delimited JSON progress events. `mkdir` calls `LIBMTP_Create_Folder` for non-destructive phone-side folder creation. Session `upload` commands carry the queued Mac device, inode, size, modification time, and change time. The helper opens that path once with `O_NOFOLLOW`, verifies the same identity with `fstat`, and gives the verified descriptor to `LIBMTP_Send_File_From_File_Descriptor`; a changed path cannot substitute different bytes during a queued upload. The helper verifies the returned destination metadata before a Mac source can be removed. Session uploads also receive an explicit UTF-8-hex destination name, so Keep Both and staged replacement still stream directly from the original Mac file. `rename-item` and `delete-item` fetch current metadata and require the object ID, storage, parent, kind, old name, file size, and available modification time to match the listed row before calling `LIBMTP_Set_File_Name` or `LIBMTP_Delete_Object`. The previous object-ID-only delete command no longer exists. Names use UTF-8 hex command arguments so whitespace cannot alter the line protocol. In app mode, these commands run inside the active `session` worker. The Electron main process owns cancellation by terminating that worker and waits for the old helper to exit before queueing another session.

Download progress is throttled in the native helper to about one event per MiB plus completion. This keeps large video copies observable without flooding the Electron IPC path or diagnostic logs.

Transfer commands use an idle timeout rather than a fixed wall-clock limit: the main process arms the command timeout when a download or upload starts, and that idle timeout is refreshed on native progress events. A 4GB+ video copy can therefore keep running as long as bytes are still moving, while a stuck command that stops reporting progress is still terminated and shown as failed.

The main process wraps session open, inventory, and folder-list calls with timeouts. A newly observed macOS USB session ID gets only a 100-millisecond settling window before the first MTP open. This matters for Samsung's `04e8:6860` MTP stack, which libmtp documents as sometimes becoming unresponsive if a session is not opened within roughly three seconds of File Transfer appearing. Bundled libmtp uses one five-second OpenSession timeout. If that USB handle does not answer, the helper exits without resetting the phone and the automatic watcher starts a fresh bounded attempt after releasing the stale claim. A ten-second parent watchdog still terminates a helper that fails to return. `PTP_ERROR_IO` means the phone did not answer; it is not treated as evidence that administrator access is required. Interface-claim failures take precedence over libmtp's generic initialization text and are reported separately as `usb-busy`.

If Samsung storage metadata is missing after a successful open, the helper exposes a synthetic Phone storage row using the reserved internal sentinel `0xfffffffe`; it does not claim that the phone reported storage ID `65537`. Opening that row lazily loads one full object index with progress and caches it for the session. Folder browsing filters the cached index, while folder creation and upload resolve one real nonzero storage ID from the index or fail explicitly if a unique writable target cannot be proven.

Connection behavior is represented by structured connection phases rather than renderer string matching: `no-phone`, `file-transfer-off`, `opening`, `listing-storage`, `ready`, `needs-mode-reset`, `needs-replug`, `usb-busy`, and `cancelled`. The renderer keeps the browser hidden until the persistent helper has opened the requested physical attachment and inventory has returned at least one readable storage location.

Raw USB presence and mode checks do not open a second MTP session. The native `status` command performs raw discovery, with an IOKit fallback when libmtp cannot see an Android interface that macOS still reports. The fallback preserves the macOS USB session ID so a mode change or physical reconnect can be distinguished from repeated polling of the same failed attachment.

When File Transfer appears, background polling starts one connection attempt. If the phone has not answered after five seconds, that failed helper releases the interface and the automatic watcher starts another bounded attempt. Attempts never overlap, never reset the USB gadget, and stop only when the phone opens, the phone leaves File Transfer mode, the cable is removed, or the user presses Cancel. Independent USB status checks continue while inventory is waiting, so a Charging to File Transfer transition cancels the stale opening helper and starts one fresh attempt on the returning MTP connection. Cancel pauses automatic attempts for that physical USB connection; Retry or a USB-mode/connection-ID change resumes them. Samsung phones can answer the first storage request with an empty list while Android is still finishing its own File transfer setup or waiting for the user's Allow tap. In that case the MTP session stays open and the poll repeats only the storage question on that same session, so there is no new OpenSession or Android prompt. The native helper never caches an empty storage answer; only a real storage list is cached for the session.

macOS assigns a new USB session ID whenever the phone re-enumerates (USB-mode switch, unlock, or a phone-side reset) even though the cable never moved. A helper opened against the previous enumeration holds a handle to hardware that no longer exists, and its answers become stale. Main therefore treats a USB-session-scoped connection ID as the identity of the open session: when the phone's current connection ID differs from the one the helper opened, the helper is closed and reopened on the new connection. Same-phone matching by serial alone is only used for raw bus/address IDs that carry no USB session.

Bundled libmtp 1.1.23 is patched for this application. The helper receives `MAC_ANDROID_TRANSFER_DISABLE_USB_RESET=1`; both the OpenSession retry reset and force-reset-on-close path are suppressed. The original LGPL source archive and the app-specific patch are packaged with release sources. Neither the app nor its test harness calls Android's USB gadget reset.

One `mtp-json session` process owns the phone. Inventory, folder listing, mutations, uploads, downloads, and transfer startup all use its command queue. Starting a session for a different attachment first closes the existing helper and waits for its exit barrier, so two helpers cannot claim the same phone concurrently. Routine status checks never replace or reopen a healthy session.

A legacy startup cleanup recognizes the old privileged-runner manifest only to request that an earlier build's detached helper stop, then removes the manifest. There is no password prompt, AppleScript privilege escalation, elevated runner, or privileged connection IPC in the current connection path.

## Device Discovery

The renderer requests `mtp:getStatus` on launch, checks every 400 milliseconds while waiting for File Transfer, and backs off to every three seconds after the phone is ready. The 400-millisecond raw USB check continues even while MTP file opening is pending; it does not open a competing MTP session. When the session is already open but the phone has not shared storage yet (a Samsung still set to Charging / No data transfer, or waiting on its Allow tap), the USB check keeps its fast cadence so a mode switch is caught at once, but the repeated storage question runs at most every two seconds because each one is a real MTP round trip. That background recheck never rewrites the waiting screen: the heading, spinner, and status pill stay on the waiting state instead of flipping to "Reading phone storage" on every retry, and the main log writes the unchanged storage answer once per 30 seconds with a repeat count. These routine checks are silent and only update meaningful connection state; the sidebar does not show the polling cadence or a constantly changing last-check time. Check now is only an immediate retry fallback, shows one compact result, and runs the same guarded status path:

1. `mtp:getStatus`
2. if connected, `mtp:scanInventory`, which opens or reuses the persistent `mtp-json session` worker
3. reset navigation to device root
4. fetch folder contents lazily through `mtp:listFolder` when the user opens a storage or folder

If inventory returns more than one MTP device, the renderer keeps a selected physical connection ID and shows a compact Phones selector in the sidebar. The native device index is only a current routing hint and may change after USB re-enumeration. Switching phones resets phone navigation, selection, drag-ready state, and folder-list tokens. Folder cache keys and row keys include the connection ID so two phones with the same storage or object IDs cannot share stale rows.

The UI consumes the structured connection phases directly. It distinguishes no phone, charging-only mode, opening, storage enumeration, ready, phone-not-responding, reconnect-required, USB-busy, and canceled states without parsing native error prose. The opening panel tells users to keep Android unlocked and tap Allow if asked; native helper paths, USB session IDs, and stderr remain collapsed under Details. Check Phone Now is a manual retry and gives one compact result.

Large folder listings always show elapsed time and an indeterminate bar. When the Samsung full-index callback reports a usable `sent/total`, main forwards a connection/storage/parent-scoped `folder-list:progress` event and the same bar becomes determinate. Each progress event also rearms the command idle timeout. Stop listing cancels active or queued `list` and `inventory` commands and invalidates the renderer's request token. A NULL storage-root result is not treated as an empty folder. For synthetic Samsung Phone storage, `LIBMTP_Get_Filelisting_With_Callback` runs at most once per session, emits newline-delimited progress JSON, and keeps the returned object tree until mutation or session close; later folders filter that tree rather than rescanning the phone.

The renderer HTML includes a static startup fallback inside `#root`, so a bundle-load failure is visible instead of a blank white window. Once React starts, `RendererErrorBoundary` catches render-time failures and shows a display-problem screen with Relaunch Window and Open Log actions when preload is available.

The Details panel also exposes Copy Report. The renderer calls `mtp:copyDiagnostics`, preload forwards it as `window.mtp.copyDiagnostics`, and the main process builds the text and writes it with Electron's clipboard API. The report includes app/runtime version, helper path, log path, status message, raw USB metadata, current session flags, aggregate queue counts, camera/import service hints, and recent native stderr. It does not include phone file listings, so users can share connection evidence without accidentally dumping folder contents.

The phone and Mac panes are keyboard-addressable. The renderer tracks the active pane so Cmd/Ctrl+1 focuses the phone pane, Cmd/Ctrl+2 focuses the Mac pane, Cmd/Ctrl+A selects visible rows in the right pane, Cmd/Ctrl+C copies the active file selection into an internal transfer clipboard, Cmd/Ctrl+V pastes that transfer clipboard to the opposite pane, Cmd/Ctrl+Enter and Cmd/Ctrl+Shift+C copy in the right direction immediately, Cmd/Ctrl+B goes to the parent folder, Cmd/Ctrl+N opens the phone New Folder dialog, Cmd/Ctrl+F focuses Filter, Cmd/Ctrl+R checks the phone now, Cmd/Ctrl+D or F2 opens Rename for one phone item, and Backspace/Delete requests permanent deletion for selected phone items. Destructive shortcuts work only while the phone pane owns focus and editable fields retain normal behavior. The transfer clipboard never publishes phone object IDs to the system clipboard; it reuses the existing safe queue path, rejects stale copied phone selections when that phone is no longer connected, and still lets editable text fields keep normal copy/paste behavior. Each pane persists its own list/grid mode and hidden-file preference. The phone setting filters dotfiles and dotfolders in the renderer, while the Mac setting asks the main process to include or hide local dotfiles during listing; the former shared preference is read once as a migration fallback. Hidden files are hidden by default. The View menu applies list, grid, and hidden-file commands to the active pane. The Mac pane keeps its own back/forward stacks, common user-folder shortcuts, and clickable path breadcrumbs so local folder browsing behaves like a normal file pane rather than a static destination picker. The divider between the phone browser and Mac pane is also keyboard-addressable: Arrow Left/Right adjusts the Mac pane width, Shift+Arrow uses a larger step, and Home/End jump between the clamped minimum and maximum. In either grid, Arrow Left/Right move by tile and Arrow Up/Down move by the computed grid column count; Enter opens the selected tile.

Mouse selection mirrors standard file managers and OpenMTP's documented behavior. Cmd/Ctrl-click toggles individual visible rows, while Shift-click selects the visible range from the last anchored phone row or Mac row to the clicked row. Each pane keeps its own selection anchor, and anchors are reset when navigation or folder changes clear the visible list. The phone summary strip always keeps the current folder count/size visible, then swaps the guidance text for a selection summary when rows are selected. The Mac action strip does the same for selected local files and folders. These summaries show selected item counts, selected file counts, known selected file size, and the next safe action so a single click has immediate visible feedback.

Right-click context menus are renderer-only affordances over the same guarded handlers used by toolbar buttons, keyboard shortcuts, and app menu commands. Phone context menus can open storage/folders, copy selected phone files/folders to the Mac, rename one item, request permanent deletion, stop a slow listing, go up, create a phone folder, or check the phone now. Dragging itself has no preparation command. Mac context menus can open folders, copy selected Mac files/folders to the phone, reveal a row in Finder, go up, refresh the current Mac folder, choose another Mac folder, or switch to Desktop.

The Electron main process installs a native application menu and forwards safe app commands over `app-menu:command`. Preload exposes that as `window.mtp.onAppMenuCommand`, and the renderer dispatches each command through the same state-aware handlers used by toolbar buttons and keyboard shortcuts. This keeps Mac menu actions such as New Folder, Check Phone Now, Copy File Selection, Paste File Selection, Copy to Queue, and Folder Up discoverable without duplicating transfer logic in the main process.

Local-pane create, rename, and Trash operations run in the main process. Every listed Mac row carries device, inode, size, modification-time, and change-time identity. Rename and Trash accept only a direct child of the currently open directory and recheck that identity immediately before acting; rename refuses to clobber an existing path. Mac delete uses Electron's `shell.trashItem`, so it remains recoverable through macOS Trash. Phone permanent delete remains a separate MTP operation with a separate native warning.

Appearance is a renderer-only preference. The topbar exposes light, dark, and system modes; the selected mode is stored in `localStorage`, and system mode follows `prefers-color-scheme`. CSS scopes the resolved theme on `.app-shell[data-theme]` so dense table, queue, dialog, and connection-help surfaces share the same tokens. The shell intentionally uses a native, neutral file-manager treatment rather than OpenMTP-style decorative chrome or always-visible debug details.

## File Listing

The renderer builds table rows from the current browser location and a per-folder cache:

- Device root: storage rows
- Storage root: cached result for parent ID `0xffffffff`
- Folder: cached result for the folder object ID

Storage entries in the sidebar use the same MTP storage metadata as the device-root rows. When total capacity is available, the sidebar shows used-of-total text, free-space text, and an accessible meter so users can understand phone capacity without opening a folder. If the phone does not report capacity metadata, the UI says the capacity is unavailable instead of rendering `0 B`.

Phone rows are sorted by name, size, modified date, or type, with folders kept above files. Mac rows use the same visible-order model for Name, Size, Modified, and Kind sorting, so keyboard movement, Shift-click range selection, and row rendering all follow the active Mac sort. File size and modified date come from libmtp for phone rows and filesystem stat data for Mac rows. After a phone folder finishes listing, the renderer summarizes the current folder with folder count, file count, and total file size. That summary uses only the current listing and does not recursively scan subfolders.

Each folder-list request carries a renderer-side token. If the user presses Stop or navigates away while the native command is still resolving, a late response is ignored instead of repainting the old folder after the UI has moved on.

The renderer defaults to the compact list/table view required for file-management work. Each pane persists its own list/grid mode and hidden-file preference. Grid tiles intentionally reuse the same selection, keyboard navigation, double-click open, native drag, and copy paths as table rows; the view switch changes presentation only. The Mac side is also a first-class file pane, not a small destination picker: it reserves a desktop-width column, has a persisted resizable split clamped so the phone table stays usable, shows sortable Finder-style Name, Modified, Kind, and Size fields, and leaves transfer status below the Mac browser.

## Transfer Queue

The renderer lists the current Mac folder through `local:listDirectory` and uses that folder as the Mac-side destination. With no explicit folder selected, the main process starts the Mac pane at the user Home folder. It also exposes `local:getCommonFolders`, which returns existing Home, Downloads, Documents, Pictures, Movies, and Desktop paths from Electron's own `app.getPath()` values. Desktop remains an explicit choice rather than the default. Selected phone folders expand recursively through `mtp:listFolder`; required Mac directories are created before file jobs begin, including real empty folders. After atomic file publication, `preserveDownloadedModifiedTime` restores the phone timestamp. Planned folder timestamps are restored deepest-first through `setLocalModifiedTime` after child jobs finish. Timestamp restoration failure is logged as a non-fatal warning because the validated file copy has already completed.

Each phone-to-Mac download streams to a hidden same-directory `.partial` path. Main validates the completed file's type and expected size before publication. If names conflict, one native batch dialog offers Keep Both, Replace, Skip Existing, or Cancel. Keep Both uses the atomic no-clobber hard-link path and numbered alternatives, setting `renamedDestination`; a late collision is never overwritten. Replace snapshots the existing regular file's device, inode, size, modification time, and change time before transfer, rechecks that identity after download, and uses the packaged native addon's `renamex_np(RENAME_SWAP)` path exchange. It verifies both displaced identities after the exchange and rolls back a mismatch before removing the approved old file. A changed file, symlink, or directory is not replaced. A file promise uses the exact coordinated URL selected by the receiver and fails rather than silently renaming it. Failed and canceled jobs remove their partial path. The `downloadSpaceError` preflight reserves known sizes by filesystem device (volume), including the actual volume selected by a file-promise drop.

Mac-to-phone upload planning lists every destination folder before queuing. A failed list stops planning instead of being interpreted as an empty folder. Any same-name phone item is a conflict regardless of size. File-file conflicts retain the existing object's ID, storage, parent, kind, name, size, and available modification time for one native Keep Both, Replace, Skip Existing, or Cancel decision. Keep Both uses a byte-safe numbered destination name; the native helper repeats its no-clobber check before reading from the identity-verified source descriptor. Replace uploads and verifies a uniquely named staging object first, renames the verified old object to a backup, renames and verifies the staging object at the requested name, then removes the backup. An explicit publication failure rolls the old name back; an ambiguous disconnect leaves the old object under the reported backup name rather than deleting it. File/folder type mismatches are skipped, while existing folders merge. Local traversal uses `lstat`, skips symbolic links, and caps file, folder, and nesting counts. The renderer also exposes New Folder for the current phone location.

Native drag-out uses an Objective-C++ bridge because Electron's public `startDrag` API only accepts local paths. The bridge creates one `NSFilePromiseProvider` per selected phone file or folder and starts an AppKit dragging session from Electron's native `NSView`. No MTP command runs when dragging begins. After Finder, Desktop, another compatible app, or the native Mac-pane receiver accepts the drop, AppKit supplies the exact destination URL. Main then plans any folder tree and queues ordinary downloads directly to that destination. `NSFileCoordinator` encloses fulfillment, and the bridge reports success only after every file is atomically published and folder timestamps are restored. Cancellation, disconnect, failure, or app quit rejects the promise and removes app-owned partial output. Dragging is always Copy; verified Move remains an explicit command.

Recursive phone-to-Mac folder copy has a planning stage before transfer jobs exist, because the app must list nested MTP folders to know which files to queue and which local directories to create. During that stage, `phoneDownloadPlanning` drives the top status pill to Preparing and renders one compact Preparing folder copy card in the queue pane. The card uses an indeterminate progress bar plus live file and folder counts from the recursive planner, so a slow MTP folder expansion has visible feedback before byte-level progress starts. Its Stop button flips a renderer cancellation flag and calls `cancelFolderListing` so the active native `list` command is terminated; the recursive planner checks that flag before queuing downloads and reports that nothing was copied.

Phone drag-out never publishes `text/plain`, which prevents Finder/Desktop from creating `.textClipping` files such as `object-43642.textClipping`. Selecting, hovering, scrolling, beginning a drag, or canceling it performs no MTP transfer. An accepted file promise emits destination-aware planning feedback and then normal byte progress. The native bridge also installs a temporary transparent promise receiver over the Mac pane during the drag, so dropping there fulfills the same promise into the currently displayed folder. Mac-pane source rows still use Electron native drag immediately because their local paths already exist.

Finder-to-phone drops use Electron's `webUtils.getPathForFile` in preload to resolve the dropped Mac `File` objects to local paths, then `local:inspectPath` classifies each path as a file or folder. The native helper creates folders with `LIBMTP_Create_Folder` and uploads files from an identity-verified descriptor with `LIBMTP_Send_File_From_File_Descriptor` and libmtp metadata for the selected storage and parent folder.

Each job tracks:

- queued, active, completed, failed, or canceled state
- bytes transferred
- total bytes
- speed
- ETA
- error details
- final destination path or phone target URI

The renderer also folds those jobs into an aggregate queue summary. It shows overall percent, copied-of-total bytes, active speed, aggregate ETA from remaining bytes, and counts for completed, failed, and canceled jobs. The top connection pill switches to Transferring, Transfer queued, or Preparing while queue work is active, so transfer state is visible even when the user's attention is on the phone browser. Bulk controls cancel every active or queued job through the same `mtp:cancelTransfer` IPC path used by individual queue rows, and Clear Finished removes only completed, failed, or canceled rows from the visible history.

Completed downloads can be revealed in Finder. Failed or canceled ordinary jobs can be retried; download retry creates a fresh unique destination path and re-runs the Mac free-space preflight. Failed promised jobs cannot be retried because the receiving app has already rejected that promise. Failed phone replacements also require a folder refresh and a new copy action because the phone may have accepted a final mutation before disconnecting; the queue does not offer an unsafe blind Retry for those jobs.

Verified file Move remains a queue operation distinct from general permanent delete. The main process owns both confirmation dialogs and forces ordinary `startDownloads` and `startUploads` calls to Copy even if renderer input claims otherwise. Phone-to-Mac Move publishes and validates the local file before sending the full listed phone identity to `delete-item`; a changed phone source is kept. Mac-to-phone Move requires the phone to report the exact uploaded object ID with a matching name and size, then rechecks the Mac source device, inode, size, modification time, and change time. It atomically renames that exact source inode to a unique same-folder quarantine name, checks the identity again, and only then unlinks it; this prevents a replacement at the original path from being deleted in a check/unlink race. If any validation or deletion step fails, the job completes as `copied; source kept` and restores the original name when possible. Folder Move is intentionally unavailable because it would require an aggregate transaction and bottom-up source deletion after every child succeeds.

## Current Boundaries

- Phone delete is permanent, requires native confirmation, and verifies the exact listed object before deletion.
- Phone rename is supported when the device implements the MTP filename property.
- Existing items are never silently overwritten; replacement requires the native collision choice and a verified publication path.
- Folder Move remains unavailable; folders can be copied or permanently deleted.

## Update Checks

The renderer schedules one quiet update check after startup when no attempt has been recorded in the previous 24 hours. Help > Check for Updates runs the same path interactively. Main uses `electron-updater` with this repository's GitHub Releases provider to read the published `latest-mac.yml` manifest. The app sends no phone, USB, path, or file data with these requests.

Stable installations use stable GitHub releases. `autoDownload` and automatic installation on quit are disabled: Update explicitly starts a download of the architecture-matched ZIP, and a separate Restart to update action installs it. Restart is refused during active transfers or phone mutations. The updater is available only from an installed, writable app; launching from a mounted DMG, Downloads, a translocated path, or an unwritable app location offers View Release and an installation explanation instead. User-facing update state is normalized before it crosses the main/renderer boundary.

Development and release builds use pinned libmtp 1.1.23 and libusb 1.0.30 sources prepared by `scripts/build-native-deps.sh`. Release jobs build each architecture natively with `MACOSX_DEPLOYMENT_TARGET=13.0`. The native build script copies `libmtp.9.dylib` and `libusb-1.0.0.dylib` into `resources/lib`, rewrites Mach-O install names to `@loader_path`, and the macOS package copies that directory into `Contents/Resources/lib`. Packaged code is checked for the correct architecture, macOS deployment target, and absence of Homebrew or local build paths. Packaging resolves the host-specific Apple Silicon or Intel output, rejects an executable with the wrong architecture, and loads the AppKit file-promise addon inside the signed Electron host, catching ABI and Team ID mismatches that static signature checks cannot detect.

Packaging also uses project-owned icon artwork from `build/app-icon.svg`, rendered to `build/icon.icns` and configured as the macOS app icon. This keeps local builds from shipping with Electron's default icon or OpenMTP branding.

Public release jobs sign nested native binaries first, sign and notarize the outer app, staple the app, build and sign the DMG, notarize and staple the DMG, then mount and reassess the final artifact. A draft GitHub release is published only after the uploaded assets are downloaded and the same checksum, signature, stapling, architecture, deployment-target, and Gatekeeper checks pass again.
