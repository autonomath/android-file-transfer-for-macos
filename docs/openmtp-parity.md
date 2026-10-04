# OpenMTP Feature Parity

This matrix tracks user-visible capability against the current `ganeshrvel/openmtp` default branch. It is evidence for the parity goal, not a claim that identical internals or identical UI are desirable.

| Capability | Status | Notes |
| --- | --- | --- |
| USB MTP connection and automatic detection | Implemented, hardware validation ongoing | Keeps USB visibility, MTP session, and storage state separate. Automatic detection is always enabled. |
| Alternative MTP backend | Planned | The current helper uses libmtp only. The compatible path is a separately packaged [`whoozle/android-file-transfer-linux`](https://github.com/whoozle/android-file-transfer-linux) IOKit helper; OpenMTP's Kalam dependency chain is not currently suitable for redistribution. |
| Internal storage and SD-card selection | Implemented | Uses reported storages, with a guarded Samsung fallback when storage metadata is missing. |
| Split local/phone file panes | Partial | Finder-style local pane, adjustable width, breadcrumbs, and common user folders. Pane visibility and left/right ordering are fixed. |
| Independent list and grid views | Implemented | Each pane remembers its own mode; dense list remains the default. |
| Multi-selection and keyboard navigation | Implemented | Includes OpenMTP selection, copy/paste, refresh, new-folder, rename, and delete shortcuts. |
| Bidirectional files and recursive folders | Partial | Transfer queue exposes progress, speed, ETA, cancel, retry, and folder-planning progress. Recursive phone folders are fully planned before file transfer begins. |
| Multiple files larger than 4 GB | Implemented | Progress refreshes an idle timeout instead of imposing a wall-clock limit. |
| Drag and drop | Implemented with stronger macOS integration | Phone drag-out uses AppKit file promises, so no USB bytes move before a destination accepts the drop. |
| New phone folder | Implemented | Uses the current storage and parent object. |
| Rename phone files and folders | Implemented; real-device matrix pending | Verifies current object identity before `LIBMTP_Set_File_Name`; some MTP devices may reject rename. |
| Permanently delete phone files and folders | Implemented; real-device matrix pending | Native confirmation, no Trash claim, exact stale-object verification, and partial-failure reporting. |
| Dark mode | Implemented | Light, dark, and system modes. |
| Independent hidden-file visibility | Implemented | Each pane remembers its own setting; hidden by default. |
| Multiple connected phones | Implemented | Browsing and connection identity are scoped per phone. |
| Privacy: no PII collection | Implemented | No telemetry; diagnostics exclude file listings. |
| Local-pane create, rename, and delete | Implemented | Local delete uses recoverable macOS Trash rather than permanent removal. |
| Collision replace/overwrite workflow | Implemented; real-device matrix pending | One batch choice offers Keep Both, Replace, Skip Existing, or Cancel. Mac replacement is identity-checked and atomic; phone replacement stages, verifies, backs up, publishes, and then cleans up. |
| In-app updates | Implemented for v0.2.0; release acceptance pending | Quiet daily and explicit Help-menu checks use the GitHub update manifest. Download and restart each require user action; beta-channel control and an auto-check preference are not implemented. |
| Intel packaged build and broad device acceptance | Published builds verified; device matrix pending | The v0.1.0 arm64 and x64 DMGs pass signature, notarization, architecture, entitlement, and macOS 12 checks. The hardened next-release workflow has not yet been run with live Apple credentials. |
| macOS version support | Intentional difference | v0.2.0 targets macOS 13 or newer. The historical v0.1.0 artifacts target macOS 12. |

The parity goal remains open until pending rows are implemented or explicitly accepted as safer product differences and the real-device acceptance checklist passes.
