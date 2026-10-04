# Attribution

## OpenMTP

OpenMTP was reviewed as a product and workflow reference for this project.

- Repository: https://github.com/ganeshrvel/openmtp
- License: MIT
- Copyright: Copyright (c) 2010-present Ganesh Rathinavel

No OpenMTP source files are copied into the v1 app code at this stage. If future work reuses OpenMTP code, preserve the OpenMTP copyright and MIT license notice in the reused source and in this attribution file.

## libmtp

The native MTP helper dynamically links against the pinned libmtp release bundled with the app.

- Project: https://github.com/libmtp/libmtp
- Version: 1.1.23
- License: LGPL-2.1-or-later

The helper in `src/native/mtp-json.c` is original project code. It uses libmtp's public C API at runtime.

## libusb

libmtp and the native MTP helper dynamically link against libusb.

- Project: https://github.com/libusb/libusb
- Version: 1.0.30
- License: LGPL-2.1-or-later

Exact source URLs, checksums, and corresponding-source release assets are documented in `THIRD_PARTY_NOTICES.md`.
