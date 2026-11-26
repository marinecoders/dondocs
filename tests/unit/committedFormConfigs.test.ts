import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson } from '@/lib/canonicalJson';
import { hasNativeWidgets, officialEdition } from '@/services/forms/nativeCatalog';
import { compileFormDefinition } from '@/services/forms/model';

const root = join(process.cwd(), 'public/templates');
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));

describe('committed form packages', () => {
  it('validates every published package, asset checksum and review', () => {
    for (const row of index.templates.filter((r: { config?: boolean; status?: string }) => r.config && r.status === 'published')) {
      const dir = join(root, row.directory);
      const d = compileFormDefinition(JSON.parse(readFileSync(join(dir, 'form.json'), 'utf8')));
      expect(d.formId).toBe(row.id);
      expect(d.directory).toBe(row.directory);
      expect(d.definitionRevision).toBe(row.definitionRevision);
      if (d.nativePdfEdition) {
        const edition = officialEdition(d.formId, d.nativePdfEdition);
        expect(hasNativeWidgets(edition?.format)).toBe(true);
        expect(edition?.directory).toBe(d.directory);
        expect(createHash('sha256').update(canonicalJson(d)).digest('hex')).toBe(edition?.definitionSha256);
        expect(row.pages).toEqual([edition!.file]);
        const original = readFileSync(join(dir, edition!.file));
        expect(original.length).toBe(edition!.length);
        expect(createHash('sha256').update(original).digest('hex')).toBe(edition!.sha256);
        continue;
      }
      const review = JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8'));
      expect(review.status).toBe('reviewed');
      expect(review.candidateDigest).toBe(d.definitionRevision);
      const candidate = { ...d, directory: row.sourceDirectory, definitionRevision: 'candidate' };
      const evidence = JSON.parse(readFileSync(join(dir, 'extraction.json'), 'utf8'));
      const changes = JSON.parse(readFileSync(join(dir, 'changes.json'), 'utf8'));
      const placementReport = JSON.parse(readFileSync(join(dir, 'placement-report.json'), 'utf8'));
      expect(createHash('sha256').update(JSON.stringify({ d: candidate, evidence, changes, placementReport })).digest('hex')).toBe(d.definitionRevision);
      expect(review.reviewer).toBeTruthy();
      const placement = JSON.parse(readFileSync(join(dir, 'placement-report.json'), 'utf8'));
      expect(placement.tested).toBeGreaterThan(0);
      expect(placement.failures).toEqual([]);
      for (const page of d.pages) expect(createHash('sha256').update(readFileSync(join(dir, page.file))).digest('hex')).toBe(page.sha256);
    }
  });
  it('loads the catalog and keeps the built-in forms outside this pipeline', () => {
    expect(index.templates.length).toBeGreaterThan(0);
    for (const id of ['navmc10274', 'navmc11811']) {
      const row = index.templates.find((r: { id: string }) => r.id === id);
      expect(row).toBeDefined();
      expect(row.config).toBeFalsy();
    }
  });
});
