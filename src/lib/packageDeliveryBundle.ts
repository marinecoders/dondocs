import JSZip from 'jszip';
import { z } from 'zod';
import { getPackageRevision, packageAssets, packageRoles, type ActionPackage } from './actionPackages';
import { MAX_PACKAGE_FILE_BYTES, parsePortableActionPackage, importPortableActionPackage } from './actionPackageTransfer';
import { portableResourceDigest } from './portableResources';
import { assertPackageDeliveryCurrent, buildPackageDeliveryFile, copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset, type PreparedPackageDelivery } from './packageDelivery';
import type { PolicyResolution } from './exportDeploymentPolicy';

export const MAX_PACKAGE_DELIVERY_BUNDLE_BYTES = 200 * 1024 * 1024;
export const MAX_PACKAGE_DELIVERY_BUNDLE_FILES = 259;
const path = z.string().max(300).regex(/^(?:files\/[0-9]{3}-[a-z0-9._-]+|package\.dondocs-package\.json|index\.html)$/);
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const fileSchema = z.object({ path, name: z.string().min(1).max(255), type: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_PACKAGE_DELIVERY_BUNDLE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/), assetId: identifier.optional() }).strict();
export const packageDeliveryManifestSchema = z.object({
  kind: z.literal('dondocs-delivery-bundle'), version: z.literal(1), packageId: identifier, revisionId: identifier,
  name: z.string().min(1).max(120), purpose: z.enum(['recipient', 'editable']), manifestPath: z.literal('manifest.json'),
  packagePath: z.literal('package.dondocs-package.json'), indexPath: z.literal('index.html'),
  members: z.array(z.object({ id: identifier, label: z.string().min(1).max(120), kind: z.enum(['native', 'original', 'attachment']), role: z.enum(packageRoles) }).strict()).min(1).max(100),
  files: z.array(fileSchema).min(2).max(MAX_PACKAGE_DELIVERY_BUNDLE_FILES - 1),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.files.map(file => file.path)).size !== manifest.files.length || new Set(manifest.files.flatMap(file => file.assetId ? [file.assetId] : [])).size !== manifest.files.filter(file => file.assetId).length)
    context.addIssue({ code: 'custom', message: 'Duplicate delivery bundle file identity.' });
  if (manifest.files.some(file => file.path.startsWith('files/') !== !!file.assetId)) context.addIssue({ code: 'custom', message: 'Every delivery file must belong to its editable package asset inventory.' });
  if (manifest.purpose === 'recipient' && manifest.members.some(member => member.kind === 'native')) context.addIssue({ code: 'custom', message: 'Recipient bundles contain rendered PDFs or original files, not editable native drafts.' });
  if (!manifest.files.some(file => file.path === manifest.packagePath && !file.assetId) || !manifest.files.some(file => file.path === manifest.indexPath && !file.assetId))
    context.addIssue({ code: 'custom', message: 'A delivery bundle needs its editable package and readable index.' });
});
export type PackageDeliveryManifest = z.infer<typeof packageDeliveryManifestSchema>;
const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'document';
const html = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function readableIndex(prepared: PreparedPackageDelivery, files: PackageDeliveryManifest['files']): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${html(prepared.packageName)}</title><style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:56rem;margin:2rem auto;padding:0 1rem}h1{overflow-wrap:anywhere}li{margin:.8rem 0;overflow-wrap:anywhere}small{display:block;color:#555}a{color:#124b91}code{font-size:.8rem;overflow-wrap:anywhere}</style></head><body><h1>${html(prepared.packageName)}</h1><p>${prepared.members.length} selected ${prepared.members.length === 1 ? 'document' : 'documents'}. This independent delivery contains the files listed below.</p><p>Open the editable package in DonDocs to recover this selected revision. Original PDFs remain separate files. A PDF derivative does not inherit a signature or approval.</p><p><a href="package.dondocs-package.json">Editable package for DonDocs</a> · <a href="manifest.json">File manifest and checksums</a></p><h2>Included documents</h2><ol>${prepared.members.map(member => `<li>${html(member.label)}<small>${html(member.role.replace(/-/g, ' '))}</small></li>`).join('')}</ol><h2>Files</h2><ul>${files.map(file => `<li><a href="${html(file.path)}">${html(file.name)}</a><small>${file.size.toLocaleString('en-US')} bytes · ${html(file.type)}</small><code>SHA-256 ${file.sha256}</code></li>`).join('')}</ul></body></html>`;
}

/** Export only the privately captured delivery. The manifest covers every payload/index entry; its own path is explicit. */
export async function buildPackageDeliveryBundle(prepared: PreparedPackageDelivery, policy: PolicyResolution, acknowledged: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<{ bytes: Uint8Array; filename: string; manifest: PackageDeliveryManifest }> {
  const packageJson = await buildPackageDeliveryFile(prepared, policy, acknowledged, signal, isCurrent);
  const projection = copyPreparedPackageDeliveryProjection(prepared), revision = getPackageRevision(projection), entries = new Map<string, Uint8Array>(), files: PackageDeliveryManifest['files'] = [];
  let expanded = 0;
  async function add(filePath: string, name: string, type: string, bytes: Uint8Array, assetId?: string) {
    signal?.throwIfAborted();
    if (!isCurrent()) throw new Error('This delivery operation is no longer current.');
    if (entries.has(filePath) || entries.size >= MAX_PACKAGE_DELIVERY_BUNDLE_FILES - 1 || bytes.byteLength > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES - expanded) throw new Error('The delivery bundle exceeds its bounded file or byte limits.');
    expanded += bytes.byteLength; entries.set(filePath, bytes);
    files.push({ path: filePath, name, type, size: bytes.byteLength, sha256: await portableResourceDigest(bytes.slice().buffer as ArrayBuffer), ...(assetId ? { assetId } : {}) });
  }
  await add('package.dondocs-package.json', 'Editable DonDocs package', 'application/json', new TextEncoder().encode(packageJson));
  const assets = [...new Map(packageAssets(projection).map(asset => [asset.id, asset])).values()];
  for (const [index, asset] of assets.entries()) await add(`files/${String(index + 1).padStart(3, '0')}-${safeName(asset.name)}`, asset.name, asset.type, new Uint8Array(await readPreparedPackageDeliveryAsset(prepared, asset)), asset.id);
  await add('index.html', 'Readable delivery index', 'text/html', new TextEncoder().encode(readableIndex(prepared, files)));
  const manifest = packageDeliveryManifestSchema.parse({ kind: 'dondocs-delivery-bundle', version: 1, packageId: projection.id, revisionId: revision.id, name: prepared.packageName, purpose: prepared.purpose,
    manifestPath: 'manifest.json', packagePath: 'package.dondocs-package.json', indexPath: 'index.html', members: prepared.members.map(member => ({ ...member })), files });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  if (manifestBytes.byteLength > 1024 * 1024 || manifestBytes.byteLength > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES - expanded) throw new Error('The delivery manifest exceeds its size limit.');
  entries.set('manifest.json', manifestBytes);
  const zip = new JSZip(), date = new Date('2000-01-01T00:00:00Z');
  for (const [name, bytes] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) zip.file(name, bytes, { binary: true, date, createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 }, streamFiles: true });
  if (bytes.byteLength > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES) throw new Error('The compressed delivery bundle exceeds its size limit.');
  await assertPackageDeliveryCurrent(prepared, policy, signal, isCurrent);
  return { bytes, filename: `${safeName(prepared.packageName)}-delivery.zip`, manifest: structuredClone(manifest) };
}
interface StreamingZipFile extends JSZip.JSZipObject { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }
function directoryCount(bytes: Uint8Array): number {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES) throw new Error('This delivery ZIP is empty or exceeds its size limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = bytes.byteLength - 22;
  if (view.getUint32(offset, true) !== 0x06054b50 || view.getUint16(offset + 20, true) !== 0 || view.getUint16(offset + 4, true) !== 0 || view.getUint16(offset + 6, true) !== 0)
    throw new Error('Use an intact single-volume DonDocs delivery ZIP without an archive comment.');
  const count = view.getUint16(offset + 10, true);
  if (!count || count > MAX_PACKAGE_DELIVERY_BUNDLE_FILES || view.getUint16(offset + 8, true) !== count || view.getUint32(offset + 16, true) + view.getUint32(offset + 12, true) !== offset)
    throw new Error('The delivery ZIP has an invalid or unsupported directory.');
  return count;
}
async function inflated(file: JSZip.JSZipObject, limit: number, counter: { bytes: number }, signal?: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []; let size = 0;
  await new Promise<void>((resolve, reject) => {
    let finished = false; const stream = (file as StreamingZipFile).internalStream('uint8array');
    const fail = (cause: unknown) => { if (finished) return; finished = true; stream.pause(); signal?.removeEventListener('abort', abort); reject(cause); };
    const abort = () => fail(new Error('Delivery import was cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('data', chunk => {
      if (finished) return;
      size += chunk.byteLength; counter.bytes += chunk.byteLength;
      if (signal?.aborted || size > limit || counter.bytes > MAX_PACKAGE_DELIVERY_BUNDLE_BYTES) { fail(new Error('The delivery ZIP exceeds its actual expanded byte limits.')); return; }
      chunks.push(chunk.slice());
    }).on('error', fail).on('end', () => { if (!finished) { finished = true; signal?.removeEventListener('abort', abort); resolve(); } }).resume();
    if (signal?.aborted) abort();
  });
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
export async function parsePackageDeliveryBundle(input: Uint8Array, signal?: AbortSignal): Promise<{ manifest: PackageDeliveryManifest; packageJson: string }> {
  signal?.throwIfAborted(); const bytes = input.slice(), count = directoryCount(bytes), zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length !== count || entries.some(file => file.dir || file.unsafeOriginalName && file.unsafeOriginalName !== file.name)) throw new Error('The delivery ZIP has duplicate or unsafe paths.');
  const manifestFile = zip.file('manifest.json'); if (!manifestFile) throw new Error('The delivery ZIP is missing its manifest.');
  const counter = { bytes: 0 }, decoder = new TextDecoder('utf-8', { fatal: true });
  const manifest = packageDeliveryManifestSchema.parse(JSON.parse(decoder.decode(await inflated(manifestFile, 1024 * 1024, counter, signal))));
  const expected = new Set([...manifest.files.map(file => file.path), 'manifest.json']);
  if (entries.length !== expected.size || entries.some(file => !expected.has(file.name))) throw new Error('The delivery ZIP contains unlisted or missing files.');
  const captured = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    signal?.throwIfAborted(); const file = zip.file(entry.path); if (!file) throw new Error('A listed delivery file is missing.');
    const maximum = entry.path === manifest.indexPath ? 1024 * 1024 : entry.path === manifest.packagePath ? MAX_PACKAGE_FILE_BYTES : 25 * 1024 * 1024;
    if (entry.size > maximum) throw new Error('A delivery ZIP entry exceeds its supported size.');
    const data = await inflated(file, entry.size, counter, signal);
    if (data.byteLength !== entry.size || await portableResourceDigest(data.slice().buffer as ArrayBuffer) !== entry.sha256) throw new Error(`The delivery file failed its checksum: ${entry.name}.`);
    captured.set(entry.path, data);
  }
  const packageJson = decoder.decode(captured.get(manifest.packagePath)!), parsed = await parsePortableActionPackage(packageJson), revision = getPackageRevision(parsed.record);
  if (parsed.record.id !== manifest.packageId || revision.id !== manifest.revisionId || parsed.record.name !== manifest.name
    || JSON.stringify(revision.members.map(member => ({ id: member.id, label: member.label, kind: member.kind, role: member.role }))) !== JSON.stringify(manifest.members))
    throw new Error('The editable package does not match the delivery manifest.');
  const assets = [...new Map(packageAssets(parsed.record).map(asset => [asset.id, asset])).values()], assetFiles = manifest.files.filter(file => file.assetId);
  if (assets.length !== assetFiles.length) throw new Error('The delivery asset inventory is incomplete.');
  for (const asset of assets) {
    const file = assetFiles.find(file => file.assetId === asset.id);
    if (!file || file.sha256 !== asset.sha256 || file.size !== asset.size || file.name !== asset.name || file.type !== asset.type) throw new Error('A delivery asset does not match its editable package.');
  }
  signal?.throwIfAborted();
  return { manifest: structuredClone(manifest), packageJson };
}
export async function importPackageDeliveryBundle(bytes: Uint8Array, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const parsed = await parsePackageDeliveryBundle(bytes, signal); signal?.throwIfAborted();
  if (!isCurrent()) throw new Error('This delivery import is no longer current.');
  return importPortableActionPackage(parsed.packageJson, signal, isCurrent);
}
