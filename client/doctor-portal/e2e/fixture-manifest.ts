import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Select one explicit fixture cohort without falling back to another database's accounts. */
export function fixtureManifestPath(): string {
  const configured = process.env.MEDICHAIN_FIXTURE_MANIFEST;
  if (configured && !isAbsolute(configured)) {
    throw new Error('MEDICHAIN_FIXTURE_MANIFEST must be an absolute path.');
  }
  const path = configured ?? fileURLToPath(new URL('../../../.browser-test/fixtures.json', import.meta.url).href);
  if (!existsSync(path)) {
    throw new Error(`Fixture manifest not found: ${path}. Seed this test cohort before running browsers.`);
  }
  return path;
}

/** Keep saved read-back IDs and reports with the cohort that owns their records. */
export function fixtureArtifactPath(name: string): string {
  if (!name || basename(name) !== name || name === '.' || name === '..') {
    throw new Error('Fixture artifact must be a single file or directory name.');
  }
  return resolve(dirname(fixtureManifestPath()), name);
}
