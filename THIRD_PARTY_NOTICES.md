# Third-party notices

Android File Transfer for macOS bundles the following dynamically linked libraries in release DMGs.

## libmtp 1.1.23

- Project: <https://libmtp.sourceforge.net/>
- Source: <https://downloads.sourceforge.net/project/libmtp/libmtp/1.1.23/libmtp-1.1.23.tar.gz>
- Source SHA-256: `74a2b6e8cb4a0304e95b995496ea3ac644c29371649b892b856e22f12a0bdeed`
- License: GNU Lesser General Public License, version 2.1 or later

## libusb 1.0.30

- Project: <https://libusb.info/>
- Source: <https://github.com/libusb/libusb/releases/download/v1.0.30/libusb-1.0.30.tar.bz2>
- Source SHA-256: `fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf`
- License: GNU Lesser General Public License, version 2.1 or later

The complete LGPL 2.1 license text is distributed with the app at `Contents/Resources/licenses/LGPL-2.1.txt` and in this repository at [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt).

The release asset `THIRD_PARTY_SOURCES-0.2.0.tar.gz` contains the exact upstream source archives, the license text, the public build script, and these notices. The libraries are dynamically linked and stored separately under the app's `Contents/Resources/lib` directory so recipients can inspect or replace them with compatible builds.

The application-specific source in this repository is MIT-licensed. No OpenMTP source files are included.
