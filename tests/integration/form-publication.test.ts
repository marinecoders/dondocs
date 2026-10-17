import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageFolder, preparePackage, reviewPackage, publishPackage, retirePackage } from '../../scripts/form-package-lib';
import { measurePlacements } from '../../scripts/form-quality';
import { fixtureDefinition, fixturePage } from '../_helpers/formFixture';

it('refuses built-in, published and symlinked publication destinations', () => {
  const root = mkdtempSync(join(tmpdir(), 'form-protected-'));
  try {
    writeFileSync(join(root, 'index.json'), JSON.stringify({ templates: [{ id: 'navmc10274', directory: 'builtin' }] }));
    expect(() => packageFolder(root, 'builtin')).toThrow(/protected/);
    expect(() => packageFolder(root, 'fixture/revisions/hash')).toThrow(/source folder/);
    symlinkSync(tmpdir(), join(root, 'link'));
    expect(() => packageFolder(root, 'link')).toThrow(/source folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('stages, measures, reviews and publishes an immutable package; rejects stale review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'form-publication-'));
  try {
    const folder = 'fixture'; const dir = join(root, folder); mkdirSync(dir);
    const page = await fixturePage();
    const d = fixtureDefinition(); d.pages[0].sha256 = page.sha256;
    writeFileSync(join(dir, 'page1.pdf'), page.bytes);
    writeFileSync(join(dir, 'form.draft.json'), JSON.stringify(d));
    writeFileSync(join(dir, 'extraction.json'), JSON.stringify({ sourceSha256: page.sha256, diagnostics: [], sourceWidgets: 13, extractedWidgets: 13 }));
    writeFileSync(join(root, 'index.json'), JSON.stringify({ templates: [{ id: 'fixture', directory: folder }] }));
    await preparePackage(root, folder);
    expect(() => publishPackage(root, folder, resolve('scripts'))).toThrow();
    const report = JSON.parse(readFileSync(join(dir, 'placement-report.json'), 'utf8'));
    expect(report.failures).toEqual([]);
    expect(report.tested).toBeGreaterThan(15); // Includes every row and both radio options.
    await reviewPackage(root, folder, 'Maintainer', 'Checked the fields and all rows against the source.', false);
    const revision = publishPackage(root, folder, resolve('scripts'));
    const published = readFileSync(join(root, revision, 'form.json'), 'utf8');
    expect(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')).templates[0]).toMatchObject({ status: 'published', sourceDirectory: folder, directory: revision });
    expect(publishPackage(root, folder, resolve('scripts'))).toBe(revision);
    const catalog = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
    catalog.templates[0].definitionRevision = 'concurrent-publication';
    writeFileSync(join(root, 'index.json'), JSON.stringify(catalog));
    expect(() => publishPackage(root, folder, resolve('scripts'))).toThrow(/Stale candidate/);
    expect(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')).templates[0].definitionRevision).toBe('concurrent-publication');
    const candidate = JSON.parse(readFileSync(join(dir, 'form.candidate.json'), 'utf8'));
    candidate.pages[0].width += 10;
    writeFileSync(join(dir, 'form.candidate.json'), JSON.stringify(candidate));
    await expect(reviewPackage(root, folder, 'Maintainer', 'Recheck', false)).rejects.toThrow(/dimensions mismatch/);
    candidate.pages[0].width -= 10;
    candidate.fields.name.label = 'Changed after review';
    writeFileSync(join(dir, 'form.candidate.json'), JSON.stringify(candidate));
    expect(() => publishPackage(root, folder, resolve('scripts'))).toThrow(/changed after review/);
    expect(readFileSync(join(root, revision, 'form.json'), 'utf8')).toBe(published);
    candidate.placements[0].box.width = 1;
    writeFileSync(join(dir, 'form.candidate.json'), JSON.stringify(candidate));
    await expect(reviewPackage(root, folder, 'Maintainer', 'Recheck', false)).rejects.toThrow(/placement-check/);
    retirePackage(root, folder, resolve('scripts'));
    expect(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')).templates[0].status).toBe('retired');
    expect(readFileSync(join(root, revision, 'form.json'), 'utf8')).toBe(published);
    // A roster-only form must exercise real cells, not receive an automatic 100%.
    const roster = { ...d, fields: {}, placements: [], sections: [] };
    const rosterReport = await measurePlacements(roster, dir);
    expect(rosterReport.tested).toBe(18);
    expect(rosterReport.negativeTested).toBe(6);
    expect(rosterReport.matched).toBe(18);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('measures option labels containing literal XML entity names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'form-quality-entities-'));
  try {
    const page = await fixturePage();
    const d = fixtureDefinition();
    d.pages[0].sha256 = page.sha256;
    d.rowGroups.roster.columns.grade.options = [{ id: 'literal', label: '&lt; "A&B"' }];
    writeFileSync(join(dir, 'page1.pdf'), page.bytes);
    const report = await measurePlacements(d, dir);
    expect(report.failures).toEqual([]);
    expect(report.matched).toBe(report.tested);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
