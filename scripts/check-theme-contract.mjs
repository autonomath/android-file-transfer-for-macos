import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

const [app, styles] = await Promise.all([
  readProjectFile('src/renderer/src/App.tsx'),
  readProjectFile('src/renderer/src/styles.css')
]);

assert.match(app, /type ThemeMode = 'system' \| 'light' \| 'dark'/, 'Renderer must model system/light/dark theme modes.');
assert.match(app, /THEME_STORAGE_KEY/, 'Theme preference must have a stable storage key.');
assert.match(app, /readStoredThemeMode/, 'Renderer must read the saved theme mode.');
assert.match(app, /setItem\(THEME_STORAGE_KEY,\s*themeMode\)/, 'Renderer must persist the selected theme mode.');
assert.match(app, /prefers-color-scheme: dark/, 'System mode must follow macOS dark appearance.');
assert.match(app, /data-theme=\{resolvedTheme\}/, 'App shell must expose the resolved theme to CSS.');
assert.match(app, /className="theme-switch"/, 'Topbar must expose a compact theme switch.');
assert.match(app, /setThemeMode\('system'\)/, 'Theme switch must include system mode.');
assert.match(app, /setThemeMode\('light'\)/, 'Theme switch must include light mode.');
assert.match(app, /setThemeMode\('dark'\)/, 'Theme switch must include dark mode.');
assert.match(app, /const \[showDiagnostics, setShowDiagnostics\]/, 'Technical diagnostics must be user-controlled.');
assert.match(app, /aria-expanded=\{showDiagnostics\}/, 'Details disclosure must expose expanded state.');
assert.match(app, /\{showDiagnostics && \(/, 'Technical diagnostics must not be always visible in the sidebar.');

assert.match(styles, /\.app-shell\[data-theme='dark'\]/, 'CSS must define a dark theme scope.');
assert.match(styles, /--app-bg:/, 'Theme CSS must use shared surface tokens.');
assert.match(styles, /--row-selected-bg:/, 'Theme CSS must define selected-row color tokens.');
assert.match(styles, /\.theme-switch/, 'Theme switch must have dedicated styling.');
assert.match(styles, /font-family:\s*\n\s*-apple-system/, 'The file-manager shell must use a native-first font stack.');
assert.doesNotMatch(styles, /Avenir Next/, 'The shell must not keep the old non-native display font treatment.');
assert.doesNotMatch(styles, /app-grid/, 'The shell must not use decorative grid background variables.');
assert.match(styles, /\.details-button\.active/, 'Details disclosure must have a compact active state.');

console.log('Theme contract check passed.');
