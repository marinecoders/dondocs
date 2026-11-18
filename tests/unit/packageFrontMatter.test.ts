import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import type { PackageRevision } from '@/lib/actionPackages';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { addPackageFrontMatter } from '@/lib/packageFrontMatter';
import { defaultPackageAssemblySettings } from '@/lib/packageAssemblyModel';
import { updatePackageAssemblySettings } from '@/lib/packageAssemblySettings';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { packageInputFingerprint } from '@/lib/packageRenderProvenance';
import { packageAssemblyInputs } from '@/lib/packageChangeImpactModel';
import * as classification from '@/config/classification';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy);
vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy);
const member = { id: 'main', revisionId: 'main-one', label: 'Main training letter', role: 'basic-letter' as const, kind: 'original' as const, required: true, signedOriginal: false,
  original: { id: 'main-file', name: 'main.pdf', type: 'application/pdf', size: 1, sha256: 'a'.repeat(64) } };
it('plans cover and contents before shifting actual physical destinations, preserving printed starts', async () => {
  const body = await PDFDocument.create(); body.addPage([612, 792]); body.addPage([612, 792]);
  const revision: PackageRevision = { id: 'revision', createdAt: 1, members: [member], outputs: [], assembly: { ...defaultPackageAssemblySettings(), cover: true, contents: true } };
  const result = await addPackageFrontMatter(body, revision, 'Synthetic training package', [{ memberId: 'main', startPage: 1, pageCount: 2, firstPageLabel: '1', numbering: 'continuation' }]);
  expect(result.frontMatterPages).toBe(2); expect(result.pdf.getPageCount()).toBe(4);
  expect(result.boundaries[0]).toMatchObject({ startPage: 3, firstPageLabel: '1', pageCount: 2 });
  const reopened = await PDFDocument.load(await result.pdf.save());
  const annotation = reopened.getPage(1).node.Annots()!.lookup(0, PDFDict);
  expect(annotation.lookup(PDFName.of('Dest'), PDFArray).get(0)).toEqual(reopened.getPage(2).ref);
  expect(annotation.lookup(PDFName.of('Rect'), PDFArray).lookup(1, PDFNumber).asNumber()).toBeGreaterThan(50);
  expect(body.getPageCount()).toBe(2);
});
it('measures long contents across multiple pages and retains every destination', async () => {
  const body = await PDFDocument.create(); const members = Array.from({ length: 50 }, (_, index) => ({ ...member, id: `member-${index}`, label: `Synthetic document ${index} with a long descriptive name that wraps in the contents column` }));
  members.forEach(() => body.addPage());
  const revision: PackageRevision = { id: 'many', createdAt: 1, members, outputs: [], assembly: { ...defaultPackageAssemblySettings(), contents: true } };
  const result = await addPackageFrontMatter(body, revision, 'Synthetic package', members.map((member, i) => ({ memberId: member.id, startPage: i + 1, pageCount: 1, firstPageLabel: String(i + 1), numbering: 'continuation' })));
  expect(result.frontMatterPages).toBeGreaterThan(1); expect(result.boundaries.at(-1)!.startPage).toBe(result.pdf.getPageCount());
  const links = result.pdf.getPages().slice(0, result.frontMatterPages).reduce((sum, page) => sum + (page.node.Annots()?.size() ?? 0), 0);
  expect(links).toBe(50);
});
it('stores guarded settings as a child and preserves them through member revisions', async () => {
  const before = await createActionPackage(`Assembly ${crypto.randomUUID()}`), settings = { ...defaultPackageAssemblySettings(), cover: true };
  const after = await updatePackageAssemblySettings(before, settings, policy);
  expect(getPackageRevision(before).assembly).toBeUndefined(); expect(getPackageRevision(after).assembly).toEqual(settings);
  const revised = await reviseActionPackage(after, []); expect(getPackageRevision(revised).assembly).toEqual(settings);
  await expect(updatePackageAssemblySettings(before, settings, policy)).rejects.toThrow();
  const aborted = new AbortController(); aborted.abort(); await expect(updatePackageAssemblySettings(revised, { ...settings, contents: true }, policy, aborted.signal)).rejects.toThrow();
});
it('includes assembly settings in PDF and signing/change-impact input identities', async () => {
  const revision: PackageRevision = { id: 'fingerprint', createdAt: 1, members: [member], outputs: [] };
  const next = { ...revision, assembly: { ...defaultPackageAssemblySettings(), cover: true } };
  expect(await packageInputFingerprint(next)).not.toBe(await packageInputFingerprint(revision));
  expect(packageAssemblyInputs(next)).not.toEqual(packageAssemblyInputs(revision));
});
