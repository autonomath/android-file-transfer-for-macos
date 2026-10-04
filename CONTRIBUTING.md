# Contributing

Android File Transfer for macOS is a focused system utility. Contributions should preserve its local-only, account-free operation and keep USB visibility distinct from an open MTP file session.

## Development

1. Use Node.js 22.12 or newer and install Xcode Command Line Tools plus `pkg-config`.
2. Run `npm ci`.
3. Set `export ARCH="$(node -p 'process.arch')"` and run `npm run native:deps -- "$ARCH"`.
4. Set `export NATIVE_DEPS_PREFIX="$PWD/.native-deps/$ARCH"` when running checks or development builds.

Before opening a pull request, run:

```sh
npm run check
npm run check:public-source
npm audit --omit=dev
```

Do not include device serial numbers, phone file listings, copied media, logs, credentials, native build output, or reference-repository contents. Use clearly synthetic identifiers in fixtures.

## Pull requests

- Keep changes scoped and explain the user-visible effect.
- Add or update a contract check for behavior changes.
- Preserve non-destructive defaults and explicit confirmation for Move.
- Never weaken release signing, notarization, or post-upload verification gates.
