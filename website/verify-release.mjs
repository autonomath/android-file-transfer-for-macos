import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(websiteDir, "..", "release-manifest.json"), "utf8"));
const releaseFile = process.argv[2];
assert.ok(releaseFile, "Pass the GitHub release JSON path");
const release = JSON.parse(await readFile(releaseFile, "utf8"));

assert.equal(release.tag_name, manifest.tag, "Release tag differs from manifest");
assert.equal(release.draft, false, "Release is still a draft");
assert.equal(release.prerelease, false, "Release is still a pre-release");
const assets = new Map(release.assets?.map((asset) => [asset.name, asset]));
for (const name of Object.values(manifest.assets)) {
  const asset = assets.get(name);
  assert.ok(asset, `Missing release asset: ${name}`);
  assert.ok(asset.size > 0, `Empty release asset: ${name}`);
  assert.equal(asset.state, "uploaded", `Release asset not uploaded: ${name}`);
}
console.log(`Published ${manifest.tag} and website download assets verified`);
