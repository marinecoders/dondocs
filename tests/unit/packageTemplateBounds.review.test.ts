import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { instantiatePackageTemplate, validatePackageTemplate } from '@/lib/packageTemplateLibrary';
import * as placeholders from '@/lib/placeholders';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
async function starter(text: string, retainedNotes = '') {
  const session = createBlankSession();
  session.formData.signatureType = 'none';
  return validatePackageTemplate({ kind: 'dondocs-package-template', version: 1, id: 'review_starter', name: 'Review starter', createdAt: 0,
    members: [{ kind: 'native', role: 'basic-letter', label: 'Starter', required: true, pages: {}, draft: {
      ...session, timestamp: 0, formData: { ...session.formData, retainedNotes }, paragraphs: [{ id: 'old_id', level: 0, text }],
    } }],
  });
}
it('bounds combined starter and fresh-file bytes before copying attachments', async () => {
  const template = await starter('Reusable letter.', 'x'.repeat(6 * 1024 * 1024));
  template.members.push(...[1, 2, 3].map(index => ({ kind: 'attachment' as const, role: 'enclosure' as const, label: `Fresh ${index}`, required: true })));
  const files = Object.fromEntries([1, 2, 3].map(index => [index, { name: 'fresh.pdf', signedOriginal: false, data: new ArrayBuffer(20 * 1024 * 1024) }]));
  const original = globalThis.structuredClone;
  const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    if (value === files) throw new Error('ATTACHMENTS_COPIED_BEFORE_COMBINED_LIMIT');
    return original(value, options);
  });
  try {
    await expect(instantiatePackageTemplate(template, 'Fresh action', {}, files)).rejects.toThrow('combined 64 MB limit');
    expect(clone.mock.calls.some(([value]) => value === files)).toBe(false);
  } finally { clone.mockRestore(); }
});
it('rejects oversized placeholder expansion before constructing expanded text', async () => {
  const template = await starter('{{NAME}}'.repeat(7000));
  const apply = vi.spyOn(placeholders, 'applyPlaceholdersToSession').mockImplementation(() => { throw new Error('EXPANDED_TEXT_BEFORE_SIZE_LIMIT'); });
  try {
    await expect(instantiatePackageTemplate(template, 'Fresh action', { NAME: 'x'.repeat(10000) }, {})).rejects.toThrow('combined 64 MB limit');
    expect(apply).not.toHaveBeenCalled();
  } finally { apply.mockRestore(); }
});


it('preserves unknown configured row groups for deliberate correction without crashing cleanup', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const { fixtureInstance } = await import('../_helpers/formFixture');
  const { portableResourceDigest } = await import('@/lib/portableResources');
  const { uint8ArrayToBase64 } = await import('@/lib/encoding');
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); const data = await pdf.save();
  const form = fixtureInstance();
  form.definition.pages = [{ file: 'page1.pdf', width: 612, height: 792, sha256: await portableResourceDigest(new Uint8Array(data).buffer) }];
  form.rows.future_group = [{ id: 'old_future_row', answers: { retained: 'Review this retained value.' } }];
  const session = createBlankSession(); session.formData.signatureType = 'none';
  const template = await validatePackageTemplate({ kind: 'dondocs-package-template', version: 1, id: 'future_rows', name: 'Future rows', createdAt: 0, members: [{
    kind: 'native', label: 'Form', role: 'basic-letter', required: true, draft: { ...session, timestamp: 0, documentCategory: 'forms', formType: form.definition.formId, genericForm: form },
    pages: { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(data) } },
  }] });
  const created = await instantiatePackageTemplate(template, 'Fresh future row action', {}, {});
  const rows = created.revisions[0].members[0].kind === 'native' && created.revisions[0].members[0].session.genericForm?.rows.future_group;
  expect(rows && rows[0].answers.retained).toBe('Review this retained value.');
  expect(rows && rows[0].id).not.toBe('old_future_row');
});
