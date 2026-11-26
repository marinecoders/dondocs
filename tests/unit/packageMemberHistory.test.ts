import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { packageMemberHistory, replacePackagePdf } from '@/lib/packageMemberHistory';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));

it('replaces one original in place, preserving both copies and rejecting stale and identical replacements', async () => {
  async function pdf(text: string) {
    const document = await PDFDocument.create();
    document.addPage().drawText(text);
    return new Uint8Array(await document.save()).buffer;
  }
  const blank = await pdf('Blank');
  const filled = await pdf('Filled');
  const first = await captureOriginalPackageMember({ name: 'same.pdf', data: blank }, 'basic-letter', false);
  const second = await captureOriginalPackageMember({ name: 'same.pdf', data: blank }, 'enclosure', false);
  const record = await reviseActionPackage(await createActionPackage('Replacement'), [first, second]);
  await expect(replacePackagePdf(record, first, new File([blank], 'copy.pdf'), false)).rejects.toThrow('already saved');
  await replacePackagePdf(record, first, new File([filled], 'filled.pdf'), false);
  const [saved] = await listActionPackages(record.id);
  const members = getPackageRevision(saved).members;
  expect(members[0]).toMatchObject({ id: first.id, role: first.role, label: first.label });
  expect(members[1]).toEqual(second);
  const history = packageMemberHistory(saved, first.id, saved.currentRevisionId);
  expect(history).toHaveLength(2);
  for (const [index, entry] of history.entries()) {
    if (entry.member.kind !== 'original') throw new Error('Expected a PDF');
    expect(await readPackageAsset(entry.member.original)).toEqual([blank, filled][index]);
  }
  await expect(replacePackagePdf(saved, first, new File([filled], 'stale.pdf'), false)).rejects.toThrow('current PDF');
});

it('prepares multiple custom originals in order without assigning two main documents', async () => {
  const { preparePackageUploads } = await import('@/lib/packageSlotFiles');
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Uint8Array.from(await pdf.save());
  const files = ['first.pdf', 'second.pdf'].map(name => new File([bytes], name));
  const { members, attachments } = await preparePackageUploads(files, 'basic-letter', false);
  expect(members.map(member => [member.label, member.role])).toEqual([['first.pdf', 'basic-letter'], ['second.pdf', 'supporting-document']]);
  expect(attachments.map(asset => asset.data.byteLength)).toEqual([bytes.length, bytes.length]);
  await expect(preparePackageUploads([...files, new File(['invalid'], 'third.pdf')], 'enclosure', false)).rejects.toThrow();
});
