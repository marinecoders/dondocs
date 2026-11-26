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

it('keeps each JAGMAN original beside its editable editions and verifies their common source', async () => {
  const { default: references } = await import('@/data/packageReferenceEditions.json');
  const { default: forms } = await import('@/data/officialPdfEditions.json');
  const { createHash } = await import('node:crypto');
  const originals = references.filter(item => item.id.startsWith('jagman_'));
  expect(originals).toHaveLength(6);
  for (const item of originals) {
    const root = 'public/templates/' + item.directory;
    const bytes = await readFile(root + '/' + item.file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
    for (const edition of forms.filter(form => form.formId === item.id && form.edition.startsWith(item.edition + '.'))) {
      expect(edition.directory.startsWith(item.directory + '/')).toBe(true);
      const filled = await readFile('public/templates/' + edition.directory + '/' + edition.file);
      expect(filled.subarray(0, bytes.length).equals(bytes)).toBe(true);
      expect(createHash('sha256').update(filled).digest('hex')).toBe(edition.sha256);
    }
  }
});

it('resolves a shared reference once and retains the rules and order of its two members', async () => {
  const { resolveMaintainedRecipe } = await import('@/lib/maintainedPackageActions');
  const { program } = await import('@/lib/packageRecipeMembers');
  const bytes = await readFile('public/templates/jagman/a-1-f/5800.7G-CH2/original.pdf');
  const fetch = vi.fn(async () => new Response(new Uint8Array(bytes)));
  vi.stubGlobal('fetch', fetch);
  const reference = { id: 'jagman_a1f', edition: '5800.7G-CH2' };
  const member = { kind: 'attachment', required: true, role: 'supporting-document', reference } as const;
  const recipe = { kind: 'dondocs-package-template', version: 2, createdAt: 0, id: 'reference-test', name: 'Reference test', primaryMemberKey: 'first',
    program: program([]), members: [
      { ...member, key: 'first', label: 'First copy', completion: { reviewedScan: true as const } },
      { ...member, key: 'second', label: 'Second copy' },
    ] } as const;
  const resolve = () => resolveMaintainedRecipe({ ...recipe, members: [...recipe.members] });
  fetch.mockResolvedValueOnce(new Response('wrong edition'));
  await expect(resolve()).rejects.toThrow('does not match');
  const template = await resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  const [first, second] = template.members;
  expect(template.members.map(item => item.key)).toEqual(['first', 'second']);
  expect(first).not.toHaveProperty('reference');
  expect(first.blankPdf).toEqual(second.blankPdf);
  expect(first.completion).toEqual({ ...second.completion, reviewedScan: true });
  expect(second.completion?.blankSha256).toMatch(/^[0-9a-f]{64}$/);
});
