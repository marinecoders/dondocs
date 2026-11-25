import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPackageBlank, readPackageBlank } from '@/lib/packageBlankForms';

afterEach(() => vi.unstubAllGlobals());

it('opens a pinned catalog edition and verifies its saved original offline', async () => {
  const bytes = await readFile('public/templates/NAVMC11811 - Administrative Remarks/2014-05/original.pdf');
  const fetch = vi.fn(async () => new Response(new Uint8Array(bytes)));
  vi.stubGlobal('fetch', fetch);
  await expect(loadPackageBlank('navmc_118_11', 'unknown')).rejects.toThrow('unavailable');
  expect(fetch).not.toHaveBeenCalled();
  const { blankPdf } = await loadPackageBlank('navmc_118_11', '2014-05');
  vi.stubGlobal('fetch', () => { throw new Error('Unexpected network access'); });
  expect(Buffer.compare(Buffer.from(await readPackageBlank(blankPdf)), bytes)).toBe(0);
  await expect(readPackageBlank({ ...blankPdf, data: 'YWJj' })).rejects.toThrow('catalog edition');
});

it('returns validation findings for an empty recipe and uses the import limit for retained actions', async () => {
  const { packageTemplateV2Schema } = await import('@/lib/packageTemplateSchema');
  const { packageConditionalStateSchema } = await import('@/lib/packageConditionalState');
  const { MAX_ACTION_TEMPLATE_BYTES } = await import('@/lib/packageTemplateLibrary');
  const answers = { version: 1, values: {}, groups: {} };
  const template = { version: 2, kind: 'dondocs-package-template', id: 'test', name: 'Test', createdAt: 0,
    members: [], program: { revision: '1', questions: [], requirements: [], participantGroups: [] } };
  expect(packageTemplateV2Schema.safeParse(template).success).toBe(false);
  const state = { version: 1, templateId: 'test', templateRevision: '1', pending: true, answers,
    facts: [], instances: [], requirementIds: [], source: { id: 'source', name: 'source.json', type: 'application/json', sha256: 'a'.repeat(64), size: MAX_ACTION_TEMPLATE_BYTES } };
  expect(packageConditionalStateSchema.safeParse(state).success).toBe(true);
  expect(packageConditionalStateSchema.safeParse({ ...state, source: { ...state.source, size: MAX_ACTION_TEMPLATE_BYTES + 1 } }).success).toBe(false);
});
