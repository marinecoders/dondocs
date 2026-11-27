import 'fake-indexeddb/auto';
import '@/components/pdf/pdfConfig';
import { readFile } from 'node:fs/promises';
import { pdfjs } from 'react-pdf';
import { afterEach, expect, it, vi } from 'vitest';
import * as catalog from '@/services/forms/nativeCatalog';
import { namedPdfChoices } from '@/services/forms/officialFormDefinition';
import { createOfficialFormMember } from '@/lib/packageOfficialForms';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage } from '@/lib/actionPackageTransfer';
import { savePackageFormValues } from '@/lib/packageFormEditing';
import { renderForm } from '@/services/forms/render';

const edition = { id: 'navmc10132', edition: '2023-08' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('resolves both named elections to the published values and reopens a saved literal answer', async () => {
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(
    await readFile('public' + decodeURIComponent(new URL(url, 'https://test.invalid').pathname)))));
  const choice = await namedPdfChoices(edition, '2_demand');
  const original = await readFile('public/templates/NAVMC10132 - Unit Punishment Book/original.pdf');
  const expected = {
    accept: 'I do not demand trial and will accept non-judicial punishment, subject to my right of appeal.',
    refuse: 'I demand trial and refuse non-judicial punishment.',
  };
  const member = await createOfficialFormMember(edition.id, 'supporting-document');
  for (const [name, value] of Object.entries(expected)) {
    expect(choice(name)).toBe(value);
    const form = { ...member.session.genericForm!, answers: { '2_demand': choice(name), '18_accused_full_name': 'TEST, SAMPLE' } };
    const filled = await renderForm(form, 'export', async () => original);
    const task = pdfjs.getDocument({ data: Uint8Array.from(filled.bytes) });
    try {
      const fields = await (await task.promise).getFieldObjects();
      expect(fields?.['2 DEMAND']?.[0]).toMatchObject({ value });
    } finally { await task.destroy(); }
  }
  // Existing drafts already store the literal PDF answer.
  const blank = await reviseActionPackage(await createActionPackage('Training'), [member]);
  const record = await savePackageFormValues(blank, member, { kind: 'configured', answers: { '2_demand': expected.refuse }, rows: {} }, new AbortController().signal);
  const restored = await parsePortableActionPackage(await buildPortableActionPackage(record));
  expect(getPackageRevision(restored.record).members[0]).toMatchObject({
    session: { genericForm: { answers: { '2_demand': expected.refuse } } },
  });
  expect(() => choice('constructor')).toThrow('Unknown choice');
  await expect(namedPdfChoices(edition, 'constructor')).rejects.toThrow('No named choices');
  await expect(namedPdfChoices({ ...edition, edition: 'other' }, '2_demand')).rejects.toThrow('unavailable');
});

it('rejects a catalog alias when its target is absent from the verified edition', async () => {
  const profile = catalog.officialEdition(edition.id, edition.edition);
  if (!profile?.choiceAliases) throw new Error('Missing qualification fixture');
  vi.spyOn(catalog, 'officialEdition').mockReturnValue({
    ...profile, choiceAliases: { '2_demand': { accept: 'obsolete choice', refuse: 'other obsolete choice' } },
  });
  vi.stubGlobal('fetch', async () => new Response(await readFile('public/templates/' + profile.directory + '/form.json', 'utf8')));
  await expect(namedPdfChoices(edition, '2_demand')).rejects.toThrow('does not match the selected edition');
});
