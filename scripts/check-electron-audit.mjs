import { execFileSync } from 'node:child_process';

// The app ships Electron's runtime, but npm counts electron as a dev dependency, so
// `npm audit --omit=dev` skips it. Fail on a high or critical advisory for electron itself.
let report;
try {
  report = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  report = error.stdout; // npm audit exits non-zero whenever any package has an advisory.
}
const electron = JSON.parse(report).vulnerabilities?.electron;
if (electron && (electron.severity === 'high' || electron.severity === 'critical')) {
  const reasons = electron.via.map((entry) => (typeof entry === 'string' ? entry : entry.title)).join('; ');
  console.error(`electron has a ${electron.severity} advisory: ${reasons}`);
  process.exit(1);
}
console.log('Electron audit check passed.');
