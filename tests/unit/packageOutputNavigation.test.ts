import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import { addPackageOutputNavigation } from '@/lib/packageOutputNavigation';
import type { PackageRevision } from '@/lib/actionPackages';

const members = ['main', 'proof'].map((id, index) => ({ id, revisionId: `${id}-revision`, label: index ? 'Supporting proof' : 'Main letter', kind: 'original' as const,
  role: index ? 'enclosure' as const : 'basic-letter' as const, required: true, signedOriginal: false,
  original: { id: `${id}-asset`, name: `${id}.pdf`, type: 'application/pdf', size: 1, sha256: 'a'.repeat(64) } }));
const revision: PackageRevision = { id: 'revision', createdAt: 1, members, outputs: [] };
describe('assembled package destinations', () => {
  it('uses physical page references while preserving continuation and separate labels', async () => {
    const pdf = await PDFDocument.create(); for (let n = 0; n < 4; n++) pdf.addPage([612, 792]);
    const entries = addPackageOutputNavigation(pdf, revision, [
      { memberId: 'main', startPage: 1, pageCount: 2, firstPageLabel: '1', numbering: 'continuation' },
      { memberId: 'proof', startPage: 3, pageCount: 2, firstPageLabel: 'Enclosure (1)', numbering: 'separate' },
    ]);
    const reopened = await PDFDocument.load(await pdf.save());
    const root = reopened.catalog.lookup(PDFName.of('Outlines'), PDFDict), first = root.lookup(PDFName.of('First'), PDFDict), last = root.lookup(PDFName.of('Last'), PDFDict);
    expect(first.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Main letter');
    expect(last.lookup(PDFName.of('Dest'), PDFArray).get(0)).toEqual(reopened.getPage(2).ref);
    const labels = reopened.catalog.lookup(PDFName.of('PageLabels'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
    expect(labels.lookup(2, PDFNumber).asNumber()).toBe(2);
    expect(entries[1]).toMatchObject({ startPage: 3, firstPageLabel: 'Enclosure (1)' });
  });
  it('rebuilds destinations from reordered captured boundaries and rejects nonexistent pages', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    const reordered = { ...revision, members: [...members].reverse() };
    const entries = addPackageOutputNavigation(pdf, reordered, [
      { memberId: 'proof', startPage: 1, pageCount: 1, firstPageLabel: 'Enclosure (1)', numbering: 'separate' },
      { memberId: 'main', startPage: 2, pageCount: 1, firstPageLabel: '1', numbering: 'continuation' },
    ]);
    expect(entries.map(item => [item.memberId, item.startPage])).toEqual([['proof', 1], ['main', 2]]);
    expect(() => addPackageOutputNavigation(pdf, revision, [{ ...entries[0], startPage: 3 }])).toThrow(/outside/);
  });
});
