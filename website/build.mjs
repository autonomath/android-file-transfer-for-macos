import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(websiteDir, "..");
const outputDir = path.join(websiteDir, "dist");
const manifest = JSON.parse(await readFile(path.join(repoDir, "release-manifest.json"), "utf8"));

assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.tag, `v${manifest.version}`);
assert.equal(manifest.releaseStatus, "release");
assert.match(manifest.macOSMinimum, /^\d+\.\d+$/);
assert.deepEqual(manifest.architectures, ["arm64", "x64"]);

const releaseBase = `https://github.com/autonomath/android-file-transfer-for-macos/releases`;
const assetUrl = (name) => {
  assert.match(name, /^[A-Za-z0-9._-]+$/);
  return `${releaseBase}/download/${manifest.tag}/${name}`;
};
const replacements = {
  "@@VERSION@@": manifest.version,
  "@@MIN_MACOS@@": `${Number.parseInt(manifest.macOSMinimum, 10)}+`,
  "@@ARM64_DMG@@": assetUrl(manifest.assets.arm64Dmg),
  "@@X64_DMG@@": assetUrl(manifest.assets.x64Dmg),
  "@@CHECKSUMS@@": assetUrl(manifest.assets.checksums),
};

let html = await readFile(path.join(websiteDir, "index.html"), "utf8");
for (const [, features] of html.matchAll(/data-feature="([A-Za-z0-9 ]+)"/g)) {
  for (const feature of features.split(/\s+/)) {
    assert.equal(manifest.features[feature], "shipped", `${feature} is advertised but not shipped`);
  }
}
for (const [token, value] of Object.entries(replacements)) {
  assert.ok(html.includes(token), `Missing template token: ${token}`);
  html = html.replaceAll(token, value);
}
assert.doesNotMatch(html, /@@[A-Z0-9_]+@@/, "Unresolved website template token");
assert.doesNotMatch(html, /releases\/download\/v0\.1\.0\//, "Stale v0.1.0 download link");

await rm(outputDir, { recursive: true, force: true });
await mkdir(path.join(outputDir, "assets"), { recursive: true });
await writeFile(path.join(outputDir, "index.html"), html);
await writeFile(path.join(outputDir, ".nojekyll"), "");
for (const file of ["styles.css", "script.js"]) {
  await cp(path.join(websiteDir, file), path.join(outputDir, file));
}
let marketData = await readFile(path.join(websiteDir, "market-data.js"), "utf8");
marketData = marketData.replaceAll("@@VERSION@@", manifest.version);
assert.doesNotMatch(marketData, /@@[A-Z0-9_]+@@/, "Unresolved market data template token");
await writeFile(path.join(outputDir, "market-data.js"), marketData);
for (const [source, name] of [
  ["build/app-icon.svg", "app-icon.svg"],
  ["docs/project-graphic.svg", "project-graphic.svg"],
  ["docs/screenshot.png", "screenshot.png"],
  ["marketing/assets/market-map.svg", "market-map.svg"],
  ["marketing/assets/architecture.svg", "architecture.svg"],
  ["marketing/assets/og-card.png", "og-card.png"],
]) {
  await cp(path.join(repoDir, source), path.join(outputDir, "assets", name));
}
console.log(`Built website for ${manifest.tag} at ${outputDir}`);
