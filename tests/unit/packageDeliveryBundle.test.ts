import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { createActionPackage, getPackageRevision, reviseActionPackage, listActionPackages, renameActionPackage } from '@/lib/actionPackages';
import { captureOriginalPackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { preparePackageDelivery } from '@/lib/packageDelivery';
import { buildPackageDeliveryBundle, parsePackageDeliveryBundle, importPackageDeliveryBundle } from '@/lib/packageDeliveryBundle';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); });
async function fixture(name = 'Selected recipient') {
  const pdf = await PDFDocument.create(); pdf.addPage(); const data = new Uint8Array(await pdf.save()).buffer;
  const included = await captureOriginalPackageMember({ name: 'Selected original.pdf', data }, 'basic-letter', true);
  const excluded = await captureOriginalPackageMember({ name: 'PRIVATE excluded original.pdf', data }, 'enclosure', false);
  const record = await reviseActionPackage(await createActionPackage(`Private source ${crypto.randomUUID()}`), [included, excluded]);
  const prepared = await preparePackageDelivery(record, record.currentRevisionId, { label: name, purpose: 'recipient', memberIds: [included.id] }, policy);
  return { record, included, excluded, prepared };
}
it('delivers an exact listed file inventory, preserved original bytes and recoverable selected revision', async () => {
  const { prepared, included, excluded, record } = await fixture(), bundle = await buildPackageDeliveryBundle(prepared, policy, true), zip = await JSZip.loadAsync(bundle.bytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(Object.keys(zip.files).sort()).toEqual([...manifest.files.map((file: { path: string }) => file.path), 'manifest.json'].sort());
  const original = manifest.files.find((file: { type: string }) => file.type === 'application/pdf');
  if (included.kind !== 'original') throw new Error('Expected original fixture.');
  expect(await zip.file(original.path)!.async('uint8array')).toEqual(new Uint8Array(await readPackageAsset(included.original)));
  const parsed = await parsePackageDeliveryBundle(bundle.bytes);
  expect(parsed.manifest.members).toHaveLength(1); expect(parsed.packageJson).not.toContain(excluded.id); expect(parsed.packageJson).not.toContain('PRIVATE excluded');
  expect(parsed.manifest.packageId).not.toBe(record.id); expect(parsed.manifest.revisionId).not.toBe(record.currentRevisionId);
  const imported = await importPackageDeliveryBundle(bundle.bytes); expect(imported.id).toBe(parsed.manifest.packageId); expect(getPackageRevision(imported).members).toHaveLength(1);
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('escapes member and delivery labels in its readable index and generates stable bytes from one captured scope', async () => {
  const { prepared } = await fixture('<script>alert(1)</script>'), first = await buildPackageDeliveryBundle(prepared, policy, true), second = await buildPackageDeliveryBundle(prepared, policy, true);
  expect(second.bytes).toEqual(first.bytes);
  const zip = await JSZip.loadAsync(first.bytes), index = await zip.file('index.html')!.async('string');
  expect(index).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(index).not.toContain('<script>'); expect(index).toContain('Content-Security-Policy');
});
it('rejects changed payload bytes and unexpected files before importing any package', async () => {
  const { prepared } = await fixture(), bundle = await buildPackageDeliveryBundle(prepared, policy, true), before = await listActionPackages();
  const modified = await JSZip.loadAsync(bundle.bytes), asset = bundle.manifest.files.find(file => file.assetId)!;
  modified.file(asset.path, 'Modified PDF bytes', { createFolders: false });
  await expect(importPackageDeliveryBundle(await modified.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/checksum/);
  const extra = await JSZip.loadAsync(bundle.bytes); extra.file('private-notes.txt', 'UNLISTED PRIVATE CONTENT', { createFolders: false });
  await expect(parsePackageDeliveryBundle(await extra.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/unlisted/);
  expect(await listActionPackages()).toEqual(before);
});
it('rejects a forged expanded size, duplicate directory count, missing manifest and cancelled work', async () => {
  const { prepared } = await fixture(), bundle = await buildPackageDeliveryBundle(prepared, policy, true);
  const forged = await JSZip.loadAsync(bundle.bytes), manifest = structuredClone(bundle.manifest); manifest.files[0].size = 1;
  forged.file('manifest.json', JSON.stringify(manifest), { createFolders: false });
  await expect(parsePackageDeliveryBundle(await forged.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/expanded byte|checksum/);
  const directory = bundle.bytes.slice(), view = new DataView(directory.buffer); view.setUint16(directory.length - 12, 0xffff, true);
  await expect(parsePackageDeliveryBundle(directory)).rejects.toThrow(/directory/);
  const missing = await JSZip.loadAsync(bundle.bytes); missing.remove('manifest.json');
  await expect(parsePackageDeliveryBundle(await missing.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/missing its manifest/);
  const aborted = new AbortController(); aborted.abort(); await expect(importPackageDeliveryBundle(bundle.bytes, aborted.signal)).rejects.toThrow();
  await expect(buildPackageDeliveryBundle(prepared, policy, false)).rejects.toThrow(/Review every/);
});
it('rejects source changes before generating another delivery archive', async () => {
  const { prepared, record } = await fixture(); await renameActionPackage(record, 'Newer source name');
  await expect(buildPackageDeliveryBundle(prepared, policy, true)).rejects.toThrow(/saved package changed/i);
});
it('recovers selected assets after every originating browser store is empty', async () => {
  const { prepared, included } = await fixture(), bundle = await buildPackageDeliveryBundle(prepared, policy, true);
  if (included.kind !== 'original') throw new Error('Expected original fixture.');
  const expected = new Uint8Array(await readPackageAsset(included.original));
  await new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open('dondocs');
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result, stores = [...database.objectStoreNames], transaction = database.transaction(stores, 'readwrite');
      for (const store of stores) transaction.objectStore(store).clear();
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  expect(await listActionPackages()).toEqual([]);
  await expect(readPackageAsset(included.original)).rejects.toThrow();
  const recovered = await importPackageDeliveryBundle(bundle.bytes), member = getPackageRevision(recovered).members[0];
  if (member.kind !== 'original') throw new Error('Expected recovered original.');
  expect(new Uint8Array(await readPackageAsset(member.original))).toEqual(expected);
});
it('rejects forged entry counts before JSZip materializes an unbounded central directory', async () => {
  const zip = new JSZip();
  for (let i = 0; i < 300; i++) zip.file(`files/${String(i).padStart(3, '0')}-synthetic.pdf`, new Uint8Array([1]), { createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array' }), view = new DataView(bytes.buffer);
  view.setUint16(bytes.length - 14, 4, true); view.setUint16(bytes.length - 12, 4, true);
  const load = vi.spyOn(JSZip, 'loadAsync');
  await expect(parsePackageDeliveryBundle(bytes)).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
});
it('rejects local/central filename disagreement, traversal and overlapping compressed data before loading ZIP entries', async () => {
  const { prepared } = await fixture(), bundle = await buildPackageDeliveryBundle(prepared, policy, true);
  const load = vi.spyOn(JSZip, 'loadAsync');
  const mismatch = bundle.bytes.slice(); mismatch[30] = mismatch[30] === 120 ? 121 : 120;
  await expect(parsePackageDeliveryBundle(mismatch)).rejects.toThrow(/local entry/); expect(load).not.toHaveBeenCalled();
  const overlap = bundle.bytes.slice(), view = new DataView(overlap.buffer), directory = view.getUint32(overlap.length - 6, true);
  view.setUint32(directory + 20, directory, true);
  await expect(parsePackageDeliveryBundle(overlap)).rejects.toThrow(/local entry/); expect(load).not.toHaveBeenCalled();
  const hostile = new JSZip(); hostile.file('../manifest.json', '{}', { createFolders: false });
  await expect(parsePackageDeliveryBundle(await hostile.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/unsafe paths/); expect(load).not.toHaveBeenCalled();
});
