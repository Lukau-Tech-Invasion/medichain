import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fixtureArtifactPath, fixtureManifestPath } from '../../e2e/fixture-manifest';

describe('browser fixture cohort selection', () => {
  const original = process.env.MEDICHAIN_FIXTURE_MANIFEST;
  const temporaryRoot = resolve(tmpdir());
  let scratch: string;
  beforeEach(() => {
    delete process.env.MEDICHAIN_FIXTURE_MANIFEST;
    scratch = mkdtempSync(join(temporaryRoot, 'medichain-fixture-cohort-'));
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MEDICHAIN_FIXTURE_MANIFEST;
    else process.env.MEDICHAIN_FIXTURE_MANIFEST = original;
    // Never recursively remove a computed path outside the temporary root.
    expect(resolve(scratch).startsWith(temporaryRoot + sep)).toBe(true);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('uses the explicit isolated cohort instead of the existing default file', () => {
    const isolated = join(scratch, 'isolated.json');
    writeFileSync(isolated, '{}');
    process.env.MEDICHAIN_FIXTURE_MANIFEST = isolated;
    expect(fixtureManifestPath()).toBe(isolated);
  });

  it('refuses a missing selected cohort rather than falling back to main credentials', () => {
    process.env.MEDICHAIN_FIXTURE_MANIFEST = join(scratch, 'missing.json');
    expect(() => fixtureManifestPath()).toThrow('Fixture manifest not found');
  });

  it('keeps read-back state in the selected cohort and refuses path traversal', () => {
    const isolated = join(scratch, 'isolated.json');
    writeFileSync(isolated, '{}');
    process.env.MEDICHAIN_FIXTURE_MANIFEST = isolated;
    expect(fixtureArtifactPath('peds-readback.json')).toBe(join(scratch, 'peds-readback.json'));
    expect(() => fixtureArtifactPath('../fixtures.json')).toThrow('single file or directory name');
  });

  it('rejects relative paths whose meaning changes with the runner working directory', () => {
    process.env.MEDICHAIN_FIXTURE_MANIFEST = 'fixtures.json';
    expect(() => fixtureManifestPath()).toThrow('must be an absolute path');
  });
});
