import { execFileSync } from 'node:child_process';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

function buildCommit(): string {
  try {
    // --exclude=* leaves only the commit hash: a tag prefix would read like a second version number.
    return execFileSync('git', ['describe', '--always', '--dirty', '--abbrev=7', '--exclude=*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Many builds share one package.json version; the commit tells them apart in diagnostics and About.
    define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()]
  }
});
