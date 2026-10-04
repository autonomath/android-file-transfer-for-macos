import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [html, main, styles, readme, architecture, checklist] = await Promise.all([
  readProjectFile('src/renderer/index.html'),
  readProjectFile('src/renderer/src/main.tsx'),
  readProjectFile('src/renderer/src/styles.css'),
  readProjectFile('README.md'),
  readProjectFile('docs/architecture.md'),
  readProjectFile('docs/manual-test-checklist.md')
]);

assert.match(
  html,
  /<div id="root">[\s\S]*Android File Transfer for macOS is starting\.[\s\S]*did\s+not finish loading its file-transfer window/,
  'Renderer HTML must contain a static startup fallback instead of an empty white root.'
);

assert.match(
  main,
  /class RendererErrorBoundary extends Component/,
  'Renderer must use an error boundary so runtime render crashes do not leave a white window.'
);

assert.match(
  main,
  /Android File Transfer for macOS hit a display problem\./,
  'Renderer error boundary must show a human-readable display problem message.'
);

assert.match(
  main,
  /window\.location\.reload\(\)/,
  'Renderer error boundary must offer a window relaunch action.'
);

assert.match(
  main,
  /window\.mtp\.openLog\(\)/,
  'Renderer error boundary must offer the app log when preload is available.'
);

assert.match(
  styles,
  /\.startup-error-detail[\s\S]*overflow-wrap: anywhere/,
  'Startup error detail must be styled so long renderer errors cannot overflow.'
);

assert.match(
  styles,
  /\.startup-actions[\s\S]*flex-wrap: wrap/,
  'Startup fallback actions must be styled for narrow windows.'
);

assert.match(
  readme,
  /renderer-crash fallbacks[\s\S]*empty white window/,
  'README must document that startup/display failures do not leave a white window.'
);

assert.match(
  architecture,
  /static startup fallback inside `#root`[\s\S]*RendererErrorBoundary/,
  'Architecture note must explain the static and React startup fallback layers.'
);

assert.match(
  checklist,
  /never stays blank white[\s\S]*display-problem message/,
  'Manual checklist must cover the no-white-window startup behavior.'
);

console.log('Startup fallback contract check passed.');
