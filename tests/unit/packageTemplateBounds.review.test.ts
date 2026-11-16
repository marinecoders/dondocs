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

