import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { packageMemberHistory, reviseUnsignedPackagePdf } from '@/lib/packageMemberHistory';

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
  await expect(reviseUnsignedPackagePdf(record, first, new File([blank], 'copy.pdf'))).rejects.toThrow('already saved');
  await reviseUnsignedPackagePdf(record, first, new File([filled], 'filled.pdf'));
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
  await expect(reviseUnsignedPackagePdf(saved, first, new File([filled], 'stale.pdf'))).rejects.toThrow('current unsigned PDF');
});
