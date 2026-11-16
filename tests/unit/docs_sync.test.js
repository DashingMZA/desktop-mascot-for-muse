import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

describe('Documentation & Version Sync Checks', () => {
  const pkg = JSON.parse(readRepoFile('package.json'));
  const tauriConf = JSON.parse(readRepoFile('src-tauri/tauri.conf.json'));
  const cargoToml = readRepoFile('src-tauri/Cargo.toml');
  const readme = readRepoFile('README.md');
  const spec = readRepoFile('docs/SPEC.md');

  it('package.json / tauri.conf.json / Cargo.toml versions match', () => {
    const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    expect(cargoVersionMatch).not.toBeNull();
    expect(tauriConf.version).toBe(pkg.version);
    expect(cargoVersionMatch[1]).toBe(pkg.version);
  });

  it('The README.md version badge matches the current app version', () => {
    expect(readme).toContain(`version-v${pkg.version}-blue.svg`);
  });

  it('The docs/SPEC.md version-to-feature table includes the current version', () => {
    expect(spec).toContain(`| v${pkg.version} |`);
  });
});
