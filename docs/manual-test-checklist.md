# Manual Test Checklist

Use a real Android phone connected over USB. Samsung Galaxy S24-class devices, including SM-S928W-style behavior, and Pixel 9 devices are primary test targets.

## Setup

- Install prerequisites: `brew install libmtp pkg-config`.
- Run `npm install`.
- Run `npm run dev`.
- For packaged builds, confirm the app icon is not the default Electron icon.
- During startup, confirm the window never stays blank white; if loading fails, it should show a plain startup or display-problem message with recovery actions.
- Connect the phone by USB.
- Unlock the phone.
- Choose File Transfer / Android Auto from the Android USB notification.

For an authorized Pixel 9 test device, identify it locally with `adb devices` and use `<your-device-serial>` as the placeholder in shared notes. Record `adb shell svc usb getFunctions` and `getprop sys.usb.config` before each test. Use `adb shell svc usb setFunctions` for the charging/debug baseline and `adb shell svc usb setFunctions mtp` for File Transfer. Verify each mode in both ADB and macOS IOKit. A mode change may temporarily disconnect ADB; wait for the same device to return instead of assuming the command failed. Restore the original functions afterward. Keep the device serial out of commits and public reports. Never call `svc usb resetUsbGadget` from the app or test harness.

## Acceptance Flow

- Starting in Charging mode, confirm the app shows **Choose File transfer on your phone** and keeps the file browser hidden.
- Change Charging to File Transfer and confirm the app automatically moves through **Opening your phone files** and **Reading your phone storage** to ready without restarting or asking for a Mac password.
- A recognizable device name or raw USB product appears in the sidebar.
- If two phones are connected, both appear under Phones; select each phone and confirm its Storage list and folder navigation reset to that phone.
- Confirm the sidebar does not show raw helper/log paths until Details is clicked.
- Click Details and confirm technical helper/log paths and stderr are available without replacing the plain-language connection guidance.
- In Details, click Copy Report and confirm the app says the connection report was copied. Paste it into a text editor and confirm it includes status, raw USB metadata, USB session identity when macOS reports it, helper/log paths, session state, and the privacy note, but not phone folder listings.
- While the phone is blocked, wait at least 3 seconds and confirm the app checks again without clicking anything.
- Confirm automatic checks do not add a persistent last-check timestamp or spinner to the sidebar.
- In no-phone and wrong-USB-mode states, confirm the main panel says there is no need to refresh instead of pushing a manual refresh button.
- Click Check now from the sidebar or USB-visible/file-session-not-open panel; confirm Check now feedback appears once, stays short, and is not duplicated above the main help panel.
- Internal storage appears in the Storage list.
- Storage rows show the full readable storage name, used/free capacity text, and a compact usage meter when capacity metadata is available.
- Opening internal storage shows root folders in the compact table.
- If Internal storage opens but libmtp returns no root folders, confirm the app shows a retryable folder error instead of silently saying the phone has no items.
- Breadcrumb, back, forward, and up navigation work.
- Click the phone table, use Up/Down to move selection, Enter/Right Arrow to open a folder, Left Arrow or Cmd/Ctrl+B to go up, Cmd/Ctrl+1 to focus the phone pane, Cmd/Ctrl+2 to focus the Mac pane, Cmd/Ctrl+A to select visible rows, Cmd/Ctrl+F to focus Filter, Cmd/Ctrl+R to check the phone now, Cmd/Ctrl+N to open New Folder, Cmd/Ctrl+D or F2 to rename one phone item, Backspace/Delete to request permanent deletion, Cmd/Ctrl+C then Cmd/Ctrl+V to queue the selected phone files/folders to the Mac pane, and Cmd/Ctrl+Shift+C or Cmd/Ctrl+Enter to queue them immediately.
- With no file or folder selected, press Cmd/Ctrl+C and Cmd/Ctrl+Shift+C; confirm nothing happens and no transfer warning appears.
- In phone grid view, confirm Arrow Left/Right move by tile, Arrow Up/Down move by one grid row, Shift+Arrow extends selection, and Enter opens the selected tile.
- Click the Mac pane, use Up/Down to move selection, Enter/Right Arrow to open a folder, Left Arrow or Cmd/Ctrl+B to go to the parent folder, Cmd/Ctrl+A to select visible Mac items, Cmd/Ctrl+C then Cmd/Ctrl+V to queue selected Mac items to the open phone folder, and Cmd/Ctrl+Shift+C or Cmd/Ctrl+Enter to copy the selected Mac items immediately.
- In Mac grid view, confirm Arrow Left/Right move by tile, Arrow Up/Down move by one grid row, Shift+Arrow extends selection, Enter opens the selected tile, and dragging a tile still starts a normal macOS file drag.
- In the phone table or grid, Cmd/Ctrl-click two separated rows to toggle them, then Shift-click another row and confirm the visible range from the last anchor is selected.
- In the Mac pane, Cmd/Ctrl-click two separated rows to toggle them, then Shift-click another row and confirm the visible range from the last anchor is selected.
- Select one or more phone files/folders and confirm the phone summary strip keeps the folder total visible while the selected-item summary shows item count, file count, selected file size, and the next safe actions.
- Select one or more Mac files/folders and confirm the Mac action strip shows the selected-item summary with file size and explains whether Copy to Phone is available.
- Right-click a phone file and confirm the menu offers Copy to Mac, Move to the named Mac folder, Rename, and Delete Permanently without a separate preparation command. For a folder selection, confirm Move is disabled while Copy, Rename, and permanent Delete remain available where valid.
- Right-click a Mac file and confirm the menu offers Copy to Phone, Move to the named phone folder, and Reveal in Finder. For a folder selection, confirm Move is disabled while Copy remains available; folders also offer Open Folder.
- Right-click empty space in each pane and confirm pane-level actions such as Check Phone Now, Refresh Mac Folder, Parent Folder, Choose Mac Folder, and New Phone Folder are understandable and enabled only when valid.
- From the macOS menu bar, confirm File > New Folder, File > Check Phone Now, Edit > Rename Selected Item, Edit > Delete Selected Items, Edit > Copy File Selection, Edit > Paste File Selection, Edit > Copy to Queue, View > Folder Up, View > Focus Phone Pane, View > Focus Mac Pane, View > List/Grid View, View > Show/Hide Hidden Files, View > Light/Dark/System Appearance, File/Help > Open Log, and File > Retry Phone Connection trigger the same active-pane actions as the toolbar or shortcuts.
- Use the title-bar appearance control to switch between light, system, and dark modes; confirm tables, queue cards, dialogs, and connection help remain readable.
- Install the signed app in Applications. Choose Help > Check for Updates and confirm it reports the current version. With a newer test release, confirm the compact Update action appears, no ZIP downloads before it is clicked, and clicking it downloads the matching architecture. Confirm Restart to update appears only after the download completes, ordinary quit does not install the update, and an explicit restart launches the new version. During an active transfer or phone mutation, confirm restart is refused until work finishes. With the network disabled, confirm the manual check gives a short offline error while the daily automatic check stays silent. Also confirm an app launched from a mounted DMG, Downloads, a translocated path, or an unwritable location offers View Release with an explanation instead of an in-place update.
- Change the phone pane to grid while leaving the Mac pane in list view, relaunch, and confirm each pane remembers its own view mode.
- Use each pane's hidden files toolbar button independently; confirm dotfiles and dotfolders are hidden by default, changing the phone does not reload the Mac folder, and both settings survive relaunch. Confirm the View menu applies to the currently focused pane.
- Opening `DCIM` or `Movies` shows files in rows, not oversized cards.
- After a folder finishes listing, confirm the phone pane shows a compact summary with folder count, file count, and total file size.
- Confirm the phone pane says that clicking selects, double-clicking opens folders, and files/folders can be dragged directly to a destination.
- While a large folder is listing, confirm the banner shows elapsed time and a real percentage when the phone reports `sent/total`; otherwise it keeps the indeterminate bar. Click Stop, confirm the spinner stops and the app says listing stopped, then confirm Retry starts only that folder again.
- Use the phone toolbar view control to switch from List to Grid; confirm grid tiles show icon, name, type or size, modified date, selection, double-click open, and the same direct drag flow.
- Confirm both transfer strips show Copy/Move as a segmented mode and an arrow that points at the named destination folder. Resize the window and confirm the destination remains understandable.
- Select one phone file, choose Move, and confirm the native warning explains that the app copies and verifies first, deletes only the source, and keeps the source on failure. Cancel and confirm nothing changes.
- Move one disposable phone file to the Mac. Confirm the destination completes before the source disappears, the queue says `moved`, and the phone folder refreshes. Force a phone deletion failure when practical and confirm the queue says `copied; source kept` without offering a duplicate-producing retry.
- Move one disposable Mac file to the phone. Confirm the phone reports the exact uploaded object with a matching name and size before the unchanged local source is deleted. Modify or replace the local source while a large move is copying and confirm the destination copy remains but the changed source is kept.
- Confirm Move is unavailable for folders in both directions; Copy must continue to handle folders recursively.
- Switch back to List and confirm the dense table is still the default after clearing the stored app data or using a fresh profile.
- Name, Size, Modified, and Type columns are visible.
- Sorting works for Name, Size, Modified, and Type.
- File sizes are visible for videos and other files.
- Choose a Mac destination folder.
- If a test Mac volume or folder has too little free space for a selected phone file, confirm the queue says not enough free space, explains to choose another Mac folder or free space, and Retry re-checks instead of starting the copy.
- The Mac pane starts at the user Home folder, showing common folders such as Documents and Downloads as a full right-side file browser, not a tiny widget.
- Confirm the Mac pane shows shortcut buttons for Home, Downloads, Documents, Pictures, Movies, and Desktop, and that each shortcut opens that folder through the same file list.
- Confirm the Mac pane shows Finder-style Name, Modified, Kind, and Size columns and enough vertical space to scan a folder.
- In the Mac pane, open a folder, then use Back, Forward, Up, and a breadcrumb segment to confirm local navigation works like a normal file browser.
- Click the Mac pane Name, Modified, Kind, and Size headers; confirm rows sort by that column and a second click reverses the direction without breaking selection.
- Drag the divider between the phone table and the Mac pane left/right; confirm the Mac pane resizes, the phone table remains usable, and the width is remembered after relaunch.
- Focus the divider and use Arrow Left/Right, Shift+Arrow, Home, and End; confirm the Mac pane resizes without mouse input.
- Drag a file or folder row from the Mac pane to Desktop/Finder and confirm macOS treats it as a normal file/folder drag.
- With the Mac pane focused, use Cmd/Ctrl+N to create a disposable folder, Cmd/Ctrl+D or F2 to rename it, and Backspace/Delete to move it to Trash. Confirm an existing name is never overwritten and the item is recoverable from macOS Trash.
- Right-click one Mac item and confirm Rename, Move to Trash, and New Mac Folder reuse the same active-pane actions. Start a transfer and confirm those mutation controls are disabled until the queue finishes.
- Open Internal storage and create a New Folder; confirm the folder appears in the phone table.
- Rename a disposable phone file and folder. Confirm the dialog starts with the full current name selected, invalid names are rejected, the same object remains selected after refresh, and an unsupported-device error does not change the visible name.
- Select multiple disposable phone items and press Delete. Cancel the native warning and confirm nothing changes. Repeat, confirm the warning says there is no Trash or Undo, then delete and confirm the folder refreshes with failed items still selected.
- Start a transfer, then confirm Rename and Delete are disabled until the queue finishes. Reconnect or change a selected item before a mutation when practical and confirm the stale identity check fails instead of changing another object.
- First select a file already visible in `DCIM` and click Copy to Mac.
- After the copy finishes, reveal the file in Finder and confirm its modified date matches the phone row instead of the copy time.
- Copy the same phone file to the same Mac folder twice. Test Keep Both, Replace, Skip Existing, and Cancel. Confirm Keep Both uses a numbered name, Replace changes only the unchanged existing regular file after the download completes, Skip copies no conflicting item, and Cancel starts no file transfer.
- During a Mac Replace test, change the existing destination before the phone download finishes; confirm replacement fails, the changed Mac file remains, and the phone source is kept for Move.
- Move the pointer over phone rows, select rows, and scroll; confirm this starts no transfer or folder scan.
- Start dragging a phone file, then cancel without dropping; confirm no queue job appears and no USB file data moves.
- Drag a visible phone file to Desktop or Finder; confirm the native drag starts immediately, the queue begins only after the drop, exactly one MTP copy runs, and no `.textClipping` file appears.
- Drag a large phone file to a destination volume with too little space; confirm the promise fails without a visible partial file and tells the user to free space and drag again.
- Drag a phone file into the app's Mac pane and confirm it copies directly into the currently displayed Mac folder.
- Select a small phone folder and click Copy to Mac; confirm the queue contains the files inside the folder under a matching Mac folder.
- While that folder copy is being planned, confirm the queue pane shows Preparing folder copy with an indeterminate progress bar and live file/folder counts before normal transfer jobs appear.
- During folder copy preparation, click Stop; confirm the Preparing card disappears, the app says Nothing was copied, and no transfer jobs are queued.
- After a copied phone folder finishes, reveal it in Finder and confirm the folder modified date matches the phone row after child copies finish.
- Copy or drag an empty phone folder to the Mac and confirm an empty Mac folder is created instead of a no-files error.
- For an empty phone folder, confirm the created Mac folder's modified date matches the phone row.
- Drag a phone folder to Desktop, Finder, or another compatible Mac app; confirm folder listing starts only after the drop, then child files copy directly into the promised folder.
- Select a file in the Mac pane and click Copy to Phone while a phone folder is open.
- Select a small folder in the Mac pane and click Copy to Phone; confirm the folder appears on the phone and its files queue as `to phone` with progress.
- Open a writable phone folder, drag one small Mac file from Finder into the phone table, and confirm it queues as `to phone` with progress.
- Drag one small Mac folder from Finder into the phone table; confirm the phone folder is created and child files queue as `to phone`.
- Copy or drop a Mac file that already exists on the phone with the same name and size; confirm the same Keep Both, Replace, Skip Existing, and Cancel choices appear instead of assuming the bytes are identical.
- Repeat with a different-sized same-name file. Confirm Keep Both uses a numbered phone name and leaves the old file unchanged.
- Choose Replace for a disposable phone file. Confirm the new bytes upload once under a temporary name, the old object remains until the staging copy is verified, the final name is verified, and no `.aft-stage-*` or `.aft-backup-*` item remains after success.
- Disconnect during a disposable phone Replace. Confirm the queue names any retained backup, does not offer blind Retry, and the old bytes still exist either at the original name or the reported backup name after reconnecting.
- Choose Skip Existing and Cancel in separate tests; confirm no conflicting file bytes transfer. For a recursive folder upload, note that any empty destination folders created while planning may remain even when the later collision dialog is canceled.
- Confirm dropping a Mac file or folder at the device root explains that Internal storage or a phone folder must be opened first.
- After the first copy succeeds, test a larger video. If a 4GB+ video is available, use it to confirm the copy keeps running while progress updates continue.
- Progress, speed, ETA, completed state, and destination are visible in the queue.
- The queue summary shows overall percent, copied-of-total bytes, active speed, ETA, and counts for done/failed/canceled items.
- While folder planning or a copy is queued or active, the top status pill changes from Connected/Files open to Preparing, Transfer queued, or Transferring.
- Reveal in Finder opens the copied file location.
- Queue two or more copies, click Cancel All, and confirm queued/active jobs become canceled without opening another MTP session.
- Click Clear Finished after completed/canceled/failed jobs exist; finished items are removed while active or queued jobs remain.
- Start a large copy and cancel it; the queue shows canceled and the log shows the single MTP worker was stopped.
- Quit the app after a normal phone-file session is open; confirm the log says `sent graceful quit to MTP session` instead of immediately killing the helper with `SIGTERM`.
- Retry the canceled or failed copy; it queues again.
- After a phone-to-Mac copy completes, confirm the copied file appears in the open Mac pane without navigating away and back.
- Unplug the phone; the app reports the disconnected/no-device state.
- Plug the phone back in; the app recovers after automatic checking or Check now without app restart.
- While opening is active, confirm the main panel has a visible spinner and Cancel action. Cancel once and confirm the state becomes **Opening was canceled** with no hidden retry.
- While opening is active, switch the phone to Charging. Confirm the stale helper closes within two status checks, then switch back to File Transfer and confirm a fresh attempt starts automatically without pressing Retry.
- On a deliberate OpenSession failure, confirm that attempt ends within ten seconds, the screen remains on **Still trying to open your phone files...**, and another bounded attempt starts automatically after the three-second polling delay.
- Leave the same failed USB attachment unchanged for at least 30 seconds. Confirm attempts continue sequentially, never overlap, never show a Retry requirement, and never reset the phone USB connection.
- Press Cancel between attempts and confirm the state becomes **Opening was canceled** with no later helper start for that unchanged connection. Press Retry and confirm automatic bounded attempts resume.
- Change File Transfer to Charging and back. Confirm the app notices the replacement USB connection within one second, waits only 100 milliseconds to settle, and opens automatically.
- Unplug and reconnect. Confirm the macOS USB session ID changes, stale storage/folder errors clear, and automatic attempts resume for the new attachment.
- After ready, browse Internal storage plus several folders and start one small transfer. Confirm every operation reuses the same helper PID and connection ID.
- Leave the ready session open for at least ten minutes while browsing several folders. Confirm the browser stays visible, status polling does not reopen the session, and no Android Allow prompt repeats.
- Confirm Details remains collapsed by default and contains the structured phase, physical connection ID, USB session ID, helper path, and bounded stderr when opened.
- Confirm the log contains no libmtp reset attempt, overlapping helper, privileged runner, or duplicate session. Automatic attempts must be visible as **Still trying** in the UI.

## Failure-State Checks

- Phone locked or waiting for Android permission: the opening panel should stay visible instead of an empty table and tell the user to keep the phone unlocked and tap Allow if Android asks.
- Charge-only USB mode: app should show the structured `file-transfer-off` guidance and no file browser.
- Missing helper: temporarily rename `resources/bin/mtp-json`; app should show bridge-missing guidance.
- No build-time `libmtp`: the native build should fail clearly. A packaged app should still load its bundled `libmtp` and `libusb` dylibs.

## Session-Open Regression

Some Android devices remain visible to IOKit in File Transfer mode while OpenSession returns `PTP_ERROR_IO`. Treat this as **phone did not answer**, never as readable storage or a macOS permission problem.

- With `ptpcamerad` shown as the selected phone's `UsbExclusiveOwner`, launch the app. Confirm it explains the conflict and waits without terminating the daemon or any client app.
- Confirm no camera-service process is terminated, regardless of its owner or whether a client was identified.
- Confirm `mtp-json status` can still report the raw Android USB interface without opening a file session.
- Confirm a failed open keeps the browser hidden, shows **Still trying to open your phone files...**, and does not invoke a password prompt or USB reset.
- Confirm the log shows sequential bounded helper attempts for that attachment, with at most one helper owning the phone at a time.
- Confirm the screen explains that the app is trying automatically and does not ask the user to press Retry or reconnect while File Transfer remains visible.
- On Samsung, switch to File transfer and let the app open its session before tapping Allow. Confirm the screen says **Waiting for your phone to share its files...** with a spinner and no Retry button, the helper stays open, and the file browser appears on its own within a few seconds of tapping Allow, with no second Android prompt. Wait well past two minutes before tapping Allow on a second run and confirm the app is still waiting rather than showing a reconnect screen.
- Leave a Samsung on **Charging** / **No data transfer** with the cable in. The phone still enumerates as 04e8:6860 with an MTP interface, so the session opens but never returns storage. Confirm the heading, spinner, and status pill (**Waiting for phone**) hold still for at least 30 seconds with no text swapping, the copy tells you to choose File transfer on the phone, an extra line naming Charging / No data transfer appears after about 12 seconds, and the log shows the storage answer about every two seconds at most with a repeat summary instead of a line pair every half second. Then switch the phone to File transfer and confirm the browser appears without a click.
- With a camera-import client such as Google Drive owning the phone through `ptpcamerad`, confirm the app shows a stable USB-busy message and names the client only when its PID, executable, and the phone's USB location match. Leave it for a minute: the daemon must not be killed on each check. Quit the client and confirm the label clears, retries resume automatically, and a readable phone opens. Do not deliberately recreate this conflict on a user's active phone; use a dedicated test device.
- Unplug and replug the phone, then take your time before switching it to File transfer. Confirm the log shows `phone re-enumerated on USB` followed by a fresh session open on the new connection, and that the file browser appears without any click.
- Confirm raw bus/address label churn within the same USB session does not start another helper.
- Confirm a changed USB session ID clears stale inventory, folder errors, and automatic-open blocking.
- After the browser opens, leave it connected for at least ten minutes and confirm transient status probes do not replace the working folder view.

For a large-file smoke test, use a non-private test file already intended for transfer:

```sh
npm run mtp:smoke -- --timeout-ms=300000 --min-size=10000000
```

## Non-Goals For v1

- Do not require folder Move. Existing items must remain protected from silent or unverified replacement.
- Do not require Wi-Fi, cloud sync, adb, or an Android companion app.

## Respectful USB conflict recovery

- On a dedicated test device, verify Keep waiting leaves all apps running while checks continue automatically.
- A verified Google Drive client must show the sync and cloud-only-file impact before Request Google Drive to quit. Other clients must explain possible imports and unsaved work.
- Click Request Quit in a controlled fixture. The app should receive its normal macOS Quit request and can show a save prompt or decline. The transfer app must never escalate to force-quit, and must report delivery rather than claim the other app has exited.
- Change the USB attachment, camera-service PID, or client process before clicking an old Quit offer. Nothing should be closed.
- An unidentified owner offers waiting and manual guidance without a guessed Quit target.
- Verify the busy message stays stable during polling and normal file access resumes when the connection is free.
