import { sign } from '@electron/osx-sign';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperEntitlements = resolve(root, 'build/entitlements.mtp-helper.plist');

export default async function signMacApp(configuration) {
  const inheritedOptionsForFile = configuration.optionsForFile;

  await sign({
    ...configuration,
    optionsForFile(filePath) {
      const defaults = inheritedOptionsForFile ? inheritedOptionsForFile(filePath) : {};
      if (filePath.endsWith('/Contents/Resources/bin/mtp-json')) {
        return {
          ...defaults,
          entitlements: helperEntitlements,
          hardenedRuntime: true
        };
      }
      return defaults;
    }
  });
}
