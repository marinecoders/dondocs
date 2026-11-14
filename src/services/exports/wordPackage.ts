import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { actionPackageSchema, getPackageRevision, type ActionPackage, type PackageMember } from '@/lib/actionPackages';
import { buildPortableActionPackage, parsePortableActionPackage, MAX_PACKAGE_FILE_BYTES } from '@/lib/actionPackageTransfer';
import { reviewPackageOriginal, reviewPackageText } from '@/lib/actionPackageDisclosure';
import { parseDraftFile } from '@/lib/draftFile';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareSessionState } from '@/stores/documentStore';
import { acknowledgePreparedExport, copyExportReview, prepareExport, type ExportReview, type PreparedExportJob } from '@/lib/preparedExport';
import { portableResourceDigest, MAX_PORTABLE_RESOURCE_BYTES, MAX_PORTABLE_TOTAL_BYTES, MAX_PORTABLE_RESOURCE_COUNT } from '@/lib/portableResources';
import { documentCapabilities, capabilityAvailable } from '@/lib/documentCapabilities';
import type { PolicyResolution } from '@/lib/exportDeploymentPolicy';
import type { StoredAttachment } from '@/lib/documentsDb';
import { detectTextPII, mergePIIResults, type PIIDetectionResult } from '@/services/pii/detector';
import { supportsCorrespondenceSignatureImage } from '@/services/docx/imageAssets';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts, type ExportAssets } from './correspondence';

export const MAX_WORD_PACKAGE_BYTES = 200 * 1024 * 1024;
export const MAX_WORD_PACKAGE_FILES = 512;
export const MAX_WORD_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const WORD_PACKAGE_LIMITATIONS = [
  'Original PDFs and enclosures remain separate unchanged files. PDF pages and PDF signing fields do not become editable Word content.',
  'Review the DOCX in Word and complete signing using your organization’s Word signing process. A visual signature image is not a certificate signature. Derivatives inherit no original signature or approval.',
  'Word and PDF use different layout engines; pagination can differ.',
] as const;

export interface WordPackageFile {
  path: string; name: string; kind: 'editable-docx' | 'original';
  size: number; sha256: string; memberId?: string; memberRevisionId?: string; purpose: string;
}
export interface WordPackageManifest {
  kind: 'dondocs-word-package'; version: 1; packageId: string; packageName: string; revisionId: string; capturedAt: number;
  completeness: 'complete'; mainDocument: string;
  members: Array<{ id: string; revisionId: string; label: string; role: PackageMember['role']; order: number; required: boolean;
    source?: { capturedAt: number; editSequence: number }; files: string[]; editableInWord: boolean; signedOriginal: boolean }>;
  files: WordPackageFile[]; limitations: readonly string[];
  limits: { maxPayloadFiles: number; maxArchiveBytes: number; maxDocxBytes: number; maxNativePackageBytes: number; maxOriginalAssetBytes: number; maxPortableResourceBytes: number; maxPortableResourceCount: number };
  measured: { fileCount: number; fileBytes: number };
}
export interface PreparedWordPackage {
  readonly packageName: string; readonly revisionId: string;
  readonly privacy: PIIDetectionResult; readonly reviews: readonly { member: string; review: ExportReview }[];
  readonly limitations: readonly string[];
}
interface WordInput { member: PackageMember; job: PreparedExportJob; assets: ExportAssets }
interface PreparedInput { manifest: WordPackageManifest; files: Map<string, Uint8Array>; words: WordInput[] }
const preparations = new WeakMap<PreparedWordPackage, PreparedInput>();
const approved = new WeakSet<PreparedWordPackage>();

/** ZIP names are generated from positions, never source paths; labels keep their Unicode spelling in the manifest. */
export function wordPackageFilename(label: string, fallback = 'document'): string {
  const basename = label.split(/[\\/]/).at(-1) || fallback;
  const portable = Array.from(basename, char => /[<>:"|?*\u202a-\u202e\u2066-\u2069]/.test(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char).join('');
  let safe = '';
  for (const char of portable) {
    if (new TextEncoder().encode(safe + char).byteLength > 160) break;
    safe += char;
  }
  safe = safe.replace(/^[. ]+|[. ]+$/g, '') || fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
}
function scopeAssets(records: Map<string, StoredAttachment>): ExportAssets {
  return { withAssets: async (ids, operation) => {
    const owned = new Map(ids.map(id => {
      const record = records.get(id);
      if (!record) throw new Error('The captured Word image is unavailable.');
      return [id, structuredClone(record)] as const;
    }));
    return operation(id => {
      const record = owned.get(id);
      if (!record) throw new Error('This image is outside the captured Word member.');
      return structuredClone(record);
    });
  } };
}

/** Capture one saved revision before review. Subsequent edits, deletions and storage changes cannot alter this operation. */
export async function prepareWordPackage(record: ActionPackage, revisionId: string, policy: PolicyResolution, signal = new AbortController().signal): Promise<PreparedWordPackage> {
  signal.throwIfAborted();
  if (policy.status !== 'ready') throw new Error(policy.message);
  const revision = getPackageRevision(record, revisionId);
  const owned = actionPackageSchema.parse({ ...record, historyScope: 'selected-revision', currentRevisionId: revision.id, revisions: [revision], workingCopies: undefined });
  const main = revision.members[0];
  if (!main || main.role !== 'basic-letter' || main.kind !== 'native' || revision.members.filter(member => member.role === 'basic-letter').length !== 1) throw new Error('A Word package must start with exactly one captured native main document.');
  // The portable action-package boundary owns validation, resource limits and foreign provenance. Keep only the selected revision.
  delete revision.parentId;
  revision.outputs = [];
  owned.revisions = [revision];owned.currentRevisionId = revision.id;delete owned.workingCopies;
  const portable = await buildPortableActionPackage(owned);
  signal.throwIfAborted();
  const { record: capturedRecord, resources } = await parsePortableActionPackage(portable);
  const captured = getPackageRevision(capturedRecord);
  const files = new Map<string, Uint8Array>(), words: WordInput[] = [], reviews: Array<{ member: string; review: ExportReview }> = [];
  const privacy: PIIDetectionResult[] = [];
  async function reviewOriginal(bytes: ArrayBuffer, label: string) {
    const review = await reviewPackageOriginal(bytes, label, policy);
    signal.throwIfAborted();reviews.push({ member: label, review });privacy.push(review.privacy);
  }
  const manifest: WordPackageManifest = {
    kind: 'dondocs-word-package', version: 1, packageId: owned.id, packageName: owned.name, revisionId: revision.id, capturedAt: revision.createdAt,
    completeness: 'complete', mainDocument: '', members: [], files: [], limitations: WORD_PACKAGE_LIMITATIONS,
    limits: { maxPayloadFiles: MAX_WORD_PACKAGE_FILES, maxArchiveBytes: MAX_WORD_PACKAGE_BYTES, maxDocxBytes: MAX_WORD_DOCUMENT_BYTES, maxNativePackageBytes: MAX_PACKAGE_FILE_BYTES, maxOriginalAssetBytes: MAX_PORTABLE_RESOURCE_BYTES, maxPortableResourceBytes: MAX_PORTABLE_TOTAL_BYTES, maxPortableResourceCount: MAX_PORTABLE_RESOURCE_COUNT },
    measured: { fileCount: 0, fileBytes: 0 },
  };
  async function add(path: string, name: string, data: ArrayBuffer, kind: WordPackageFile['kind'], purpose: string, member?: PackageMember) {
    signal.throwIfAborted();
    if (files.has(path)) throw new Error('Duplicate Word package path.');
    if (files.size + words.length >= MAX_WORD_PACKAGE_FILES) throw new Error('A Word package is limited to 512 payload files.');
    if (!data.byteLength) throw new Error(`The saved file ${name} is empty.`);
    files.set(path, new Uint8Array(data.slice(0)));
    manifest.files.push({ path, name, kind, size: data.byteLength, sha256: await portableResourceDigest(data), purpose,
      ...(member ? { memberId: member.id, memberRevisionId: member.revisionId } : {}) });
    if (member) manifest.members.find(entry => entry.id === member.id)!.files.push(path);
  }
  for (const [index, member] of captured.members.entries()) {
    signal.throwIfAborted();
    const position = String(index + 1).padStart(3, '0'), folder = `members/${position}`;
    manifest.members.push({ id: member.id, revisionId: member.revisionId, label: member.label, role: member.role, order: index + 1, required: member.required,
      ...(member.kind === 'native' && member.source ? { source: { capturedAt: member.source.capturedAt, editSequence: member.source.editSequence } } : {}),
      files: [], editableInWord: false, signedOriginal: member.kind === 'original' && member.signedOriginal });
    if (member.kind === 'original') {
      const bytes = resources.get(`assets/${member.original.id}`)!.data;
      await PDFDocument.load(bytes.slice(0));
      await reviewOriginal(bytes, member.label);
      await add(`${folder}/original/${wordPackageFilename(member.original.name)}`, member.original.name, bytes, 'original', member.signedOriginal ? 'Unchanged signed original; signature validity must be checked in the original file.' : 'Unchanged original supporting PDF.', member);
      continue;
    }
    const reviewed = parseDraftFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resources.get(`assets/${member.draft.id}`)!.data)), false, true);
    const capability = documentCapabilities({ ...reviewed.session, documentMode: reviewed.session.documentMode ?? 'compliant' }, { operation: 'export', target: 'docx' });
    if (!capabilityAvailable(capability)) throw new Error(`${member.label}: ${capability.status === 'supported' ? '' : capability.message} Use the editable package export for native forms/publications, or add their original PDF as a supporting member.`);
    const snapshot = prepareSessionState(reviewed.session, true), assets = new Map<string, StoredAttachment>();
    const original = async (data: ArrayBuffer, name: string, type: string, slot: string, purpose: string) => {
      if (type === 'application/pdf') {
        await PDFDocument.load(data.slice(0));
        await reviewOriginal(data, `${member.label}: ${name}`);
      }
      await add(`${folder}/original/${slot}-${wordPackageFilename(name)}`, name, data, 'original', purpose, member);
    };
    for (const [offset, enclosure] of snapshot.enclosures.entries()) {
      const file = reviewed.files[offset];
      if (!file) throw new Error(`${member.label}: required enclosure “${enclosure.title || offset + 1}” has no captured original file. Attach it and save a new package revision.`);
      await original(file.data, file.name, 'application/pdf', `enclosure-${String(offset + 1).padStart(3, '0')}`, `Unchanged enclosure (${offset + 1}): ${enclosure.title}. Separate from DOCX.`);
      enclosure.file = structuredClone(file);
    }
    if (snapshot.docType === 'new_page_endorsement' && reviewed.basicLetter) await original(reviewed.basicLetter.data, reviewed.basicLetter.name, 'application/pdf', 'basic-letter', 'Unchanged basic-letter PDF captured with this member; separate from DOCX.');
    for (const [offset, file] of reviewed.figures.entries()) if (file) {
      const figure = snapshot.paragraphs[offset].figure!;
      const id = `figure-${offset}`;
      figure.fileRef = { id, name: file.name, type: figure.type || 'image/png', size: file.data.byteLength };
      assets.set(id, { ...figure.fileRef, data: file.data.slice(0) });
      await original(file.data, file.name, figure.type || 'image/png', `figure-${String(offset + 1).padStart(3, '0')}`, 'Unchanged captured figure image.');
    }
    const signature = snapshot.formData.signatureImage;
    if (snapshot.formData.signatureType === 'image' && supportsCorrespondenceSignatureImage(snapshot.docType) && signature?.data) {
      const { base64ToUint8Array } = await import('@/lib/encoding');
      await original(new Uint8Array(base64ToUint8Array(signature.data)).buffer, signature.name, 'image/png', 'signature', 'Unchanged visual signature image; not a certificate signature.');
    }
    const source = { documentId: member.id, epoch: 0, editSequence: member.source?.editSequence ?? 0, capturedAt: member.source?.capturedAt ?? captured.createdAt };
    const document = captureDocumentRevision(source, snapshot);
    const path = `${folder}/${wordPackageFilename(member.label)}.docx`;
    const preparation = prepareExport({ id: `${captured.id}_${member.revisionId}_word-package`, captured: document, target: 'docx', filename: path.split('/').at(-1)!, policy });
    if ('issues' in preparation) throw new Error(`${member.label}: ${preparation.issues.join(' ')}`);
    const job = preparation.status === 'ready' ? preparation.job.job : preparation.job, review = copyExportReview(job);
    reviews.push({ member: member.label, review });privacy.push(review.privacy);
    {
      manifest.members[index].editableInWord = true;
      // Reserve output paths before conversion, keeping the manifest order independent of completion timing.
      manifest.members[index].files.unshift(path);
      if (index === 0) manifest.mainDocument = path;
      if (files.size + words.length >= MAX_WORD_PACKAGE_FILES) throw new Error('A Word package is limited to 512 payload files.');
      words.push({ member, job, assets: scopeAssets(assets) });
    }
  }
  const names = [{ field: 'Package name', value: manifest.packageName }, ...manifest.members.map(member => ({ field: `Member ${member.order} label`, value: member.label })), ...manifest.files.map(file => ({ field: 'Included filename', value: file.name }))];
  reviewPackageText(names.map(field => field.value).join('\n'), 'Word package labels and filenames', policy);
  privacy.push(detectTextPII(names));
  const result: PreparedWordPackage = Object.freeze({ packageName: owned.name, revisionId: captured.id, privacy: mergePIIResults(privacy), reviews: structuredClone(reviews), limitations: WORD_PACKAGE_LIMITATIONS });
  preparations.set(result, { manifest, files, words });
  signal.throwIfAborted();
  return result;
}

/** Approval is scoped to this captured revision and the Word package target. */
export function acknowledgeWordPackage(prepared: PreparedWordPackage): void {
  if (!preparations.has(prepared)) throw new Error('This Word package was not prepared.');
  approved.add(prepared);
}

export async function renderWordPackage(prepared: PreparedWordPackage, ports: CorrespondenceRendererPorts, signal = new AbortController().signal): Promise<{ blob: Blob; filename: string; manifest: WordPackageManifest }> {
  const input = preparations.get(prepared);
  if (!input || !approved.has(prepared)) throw new Error('Review and approve this captured Word package before downloading.');
  signal.throwIfAborted();
  const manifest = structuredClone(input.manifest), zip = new JSZip();
  let fileBytes = [...input.files.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
  for (const [path, bytes] of input.files) zip.file(path, new Uint8Array(bytes));
  for (const word of input.words) {
    signal.throwIfAborted();
    const ready = acknowledgePreparedExport(word.job);
    const artifact = await renderPreparedCorrespondence(ready, { ...ports, assets: word.assets }, signal);
    if (artifact.completeness !== 'complete') throw new Error(artifact.issues.map(issue => issue.message).join(' '));
    if (artifact.blob.size > MAX_WORD_DOCUMENT_BYTES) throw new Error('A Word document exceeds the 25 MB delivery limit.');
    fileBytes += artifact.blob.size;
    if (fileBytes > MAX_WORD_PACKAGE_BYTES) throw new Error('The Word package exceeds the 200 MB expanded file limit.');
    const bytes = await artifact.blob.arrayBuffer(), path = manifest.members.find(member => member.id === word.member.id)!.files[0];
    zip.file(path, bytes);
    manifest.files.push({ path, name: path.split('/').at(-1)!, kind: 'editable-docx', size: bytes.byteLength, sha256: await portableResourceDigest(bytes), memberId: word.member.id, memberRevisionId: word.member.revisionId, purpose: word.member.role === 'basic-letter' ? 'Editable main Word document.' : 'Editable supported correspondence; separate from the main Word document.' });
  }
  manifest.measured = { fileCount: manifest.files.length, fileBytes: manifest.files.reduce((total, file) => total + file.size, 0) };
  if (manifest.measured.fileBytes > MAX_WORD_PACKAGE_BYTES) throw new Error('The Word package exceeds the 200 MB expanded file limit.');
  const manifestText = JSON.stringify(manifest, null, 2);
  const readme = [`${manifest.packageName}\nWord package · captured revision ${manifest.revisionId}`, `MAIN WORD DOCUMENT: ${manifest.mainDocument}`, 'MEMBERS (saved package order)', ...manifest.members.map(member => `${member.order}. ${member.label}\n   Role: ${member.role}; member revision: ${member.revisionId}; ${member.editableInWord ? 'editable DOCX' : 'separate original/native content'}\n${member.files.map(path => `   ${path}`).join('\n')}`), 'FILES (SHA-256 verifies exact bytes)', ...manifest.files.map(file => `${file.path}\n   ${file.size} bytes · SHA-256 ${file.sha256}\n   ${file.purpose}`), 'DELIVERY BOUNDARIES', ...manifest.limitations, `Measured payload: ${manifest.measured.fileCount} files, ${manifest.measured.fileBytes} bytes (excluding this README and manifest). Limits: 200 MB archive/expanded payload; 25 MB per DOCX/original asset; 512 payload files; captured inputs: 100 MB native JSON, 75 MB resources, 256 resources.`, 'The manifest records digests for every payload file. It does not authenticate a sender.'].join('\n\n');
  if (fileBytes + new TextEncoder().encode(manifestText + readme).byteLength > MAX_WORD_PACKAGE_BYTES) throw new Error('The Word package exceeds the 200 MB expanded archive limit.');
  zip.file('manifest.json', manifestText);zip.file('README.txt', readme);
  signal.throwIfAborted();
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  signal.throwIfAborted();
  if (blob.size > MAX_WORD_PACKAGE_BYTES) throw new Error('The Word package exceeds the 200 MB archive limit.');
  return { blob, filename: `${wordPackageFilename(manifest.packageName)}-word-package.zip`, manifest };
}
