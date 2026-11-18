import { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId, type ActionPackage, type PackageRevision } from './actionPackages';
import { readPackageAsset, validatePackageOriginalPdf } from './actionPackageAssets';
import { packageScanSchema, packageScansSchema, packageScansText, packageScanIsCurrent, type PackageScan, type PackageScans } from './packageScanModel';
import type { ScanProgress } from './scannedImport';
import { inspectRasterImage } from '@/services/docx/imageAssets';
import { reviewPackageOriginal, reviewPackageText } from './actionPackageDisclosure';
import type { ExportReview } from './preparedExport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { preparePackageUpdate } from './packageUpdates';
import { PDFDocument } from 'pdf-lib';
import { portableResourceDigest } from './portableResources';
import { reviewPackageAttachment } from './packageAttachmentCapabilities';
export * from './packageScanModel';

export interface PreparedPackageScan {
  readonly scan: PackageScan;
  readonly saved: boolean;
  readonly reviews: readonly ExportReview[];
}
interface Capture { record: ActionPackage; sourceRevisionId: string; scan: PackageScan; bytes: ArrayBuffer; policy: string }
const preparations = new WeakMap<PreparedPackageScan, Capture>();
export interface PreparedPackageScanCorrection { readonly scan: PackageScan; readonly reviews: readonly ExportReview[] }
const corrections = new WeakMap<PreparedPackageScanCorrection, { before: ActionPackage; after: ActionPackage; policy: string }>();
const policyKey = (policy: PolicyResolution) => { if (policy.status !== 'ready') throw new Error(policy.message); return JSON.stringify(policy.policy); };
function owner(record: ActionPackage) {
  if (record.archived || record.reviewRounds?.some(round => round.ownerPackageId === undefined)) throw new Error('Recognize and correct evidence from the current, unarchived owning package.');
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
async function sourceReview(scan: PackageScan, bytes: ArrayBuffer, policy: PolicyResolution): Promise<ExportReview> {
  return scan.source.type === 'application/pdf' ? reviewPackageOriginal(bytes, scan.source.name, policy)
    : reviewPackageText(scan.source.name, 'Original scanned image filename', policy);
}
export async function validatePackageScanSource(scan: PackageScan, bytes: ArrayBuffer): Promise<void> {
  if (scan.source.type === 'application/pdf') {
    await validatePackageOriginalPdf(bytes);
    if ((await PDFDocument.load(bytes)).getPageCount() !== scan.pages.length) throw new Error('Recognized evidence pages do not match the exact retained source PDF.');
  } else await inspectRasterImage(new Uint8Array(bytes), scan.source.type);
}
/** Full-revision restoration and transfer include old sources even after their member is replaced. */
export async function reviewPackageScanSources(input: PackageScans, policy: PolicyResolution, options: {
  readAsset?: typeof readPackageAsset; reviewOriginal?: typeof reviewPackageOriginal; signal?: AbortSignal;
} = {}): Promise<Array<{ member: string; review: ExportReview }>> {
  const scans = packageScansSchema.parse(structuredClone(input)), read = options.readAsset ?? readPackageAsset;
  const inspected = new Map<string, { identity: string; pages: number }>();
  const reviews: Array<{ member: string; review: ExportReview }> = [];
  for (const scan of scans.items) {
    options.signal?.throwIfAborted();
    const identity = JSON.stringify(scan.source), previous = inspected.get(scan.source.id);
    if (previous) {
      if (previous.identity !== identity || previous.pages !== scan.pages.length) throw new Error('Conflicting retained scan source identity or page count.');
      continue;
    }
    const bytes = (await read(scan.source)).slice(0);
    options.signal?.throwIfAborted();
    if (bytes.byteLength !== scan.source.size || await portableResourceDigest(bytes) !== scan.source.sha256)
      throw new Error('The retained scan source does not match its captured bytes.');
    await validatePackageScanSource(scan, bytes);
    options.signal?.throwIfAborted();
    const label = `Retained scan source: ${scan.source.name}`;
    reviews.push({ member: label, review: scan.source.type === 'application/pdf'
      ? await (options.reviewOriginal ?? reviewPackageOriginal)(bytes, label, policy)
      : (await reviewPackageAttachment(scan.source, bytes, policy, options.signal)).review });
    options.signal?.throwIfAborted();
    inspected.set(scan.source.id, { identity, pages: scan.pages.length });
  }
  return reviews;
}
export async function preparePackageScan(input: ActionPackage, memberId: string, policy: PolicyResolution, signal = new AbortController().signal,
  progress: (progress: ScanProgress) => void = () => {}): Promise<PreparedPackageScan> {
  const record = actionPackageSchema.parse(structuredClone(input)), identity = policyKey(policy); owner(record); signal.throwIfAborted();
  const revision = getPackageRevision(record), member = revision.members.find(member => member.id === memberId);
  if (!member || member.kind === 'native' || !['application/pdf', 'image/png', 'image/jpeg'].includes(member.original.type)) throw new Error('Choose a captured PDF, PNG or JPEG member for recognition.');
  if (member.original.size > 20 * 1024 * 1024) throw new Error('Scanned evidence supports original files up to 20 MB.');
  const bytes = await readPackageAsset(member.original); signal.throwIfAborted();
  const originalReview = member.original.type === 'application/pdf' ? await reviewPackageOriginal(bytes, member.original.name, policy) : reviewPackageText(member.original.name, 'Original scanned image filename', policy);
  signal.throwIfAborted();
  const { recognizeScannedFile } = await import('./scannedImport');
  signal.throwIfAborted();
  const result = await recognizeScannedFile(new File([bytes], member.original.name, { type: member.original.type }), signal, progress);
  const now = Date.now(), previous = revision.scans?.items.find(scan => scan.memberId === memberId && packageScanIsCurrent(scan, revision));
  const scan = packageScanSchema.parse({ id: previous?.id ?? newPackageId('scan'), memberId, memberRevisionId: member.revisionId, memberLabel: member.label,
    source: member.original, capturedAt: now, updatedAt: now, status: 'recognized', pages: result.map(page => ({ page: page.page, recognizedText: page.text, text: page.text, confidence: page.confidence })) });
  const reviews = [originalReview, reviewPackageText(packageScansText({ version: 1, items: [scan] }), 'Recognized evidence text and source association', policy)];
  signal.throwIfAborted(); const prepared = freeze({ scan: structuredClone(scan), saved: false, reviews });
  preparations.set(prepared, { record, sourceRevisionId: revision.id, scan, bytes, policy: identity }); return prepared;
}
export async function openPackageScan(input: ActionPackage, scanId: string, policy: PolicyResolution, signal?: AbortSignal, revisionId = input.currentRevisionId): Promise<PreparedPackageScan> {
  const record = actionPackageSchema.parse(structuredClone(input)), identity = policyKey(policy); signal?.throwIfAborted();
  const scan = getPackageRevision(record, revisionId).scans?.items.find(scan => scan.id === scanId);
  if (!scan) throw new Error('This saved evidence extraction is unavailable.');
  const bytes = await readPackageAsset(scan.source); await validatePackageScanSource(scan, bytes); signal?.throwIfAborted();
  const reviews = [await sourceReview(scan, bytes, policy), reviewPackageText(packageScansText({ version: 1, items: [scan] }), 'Saved corrected evidence and source association', policy)];
  const prepared = freeze({ scan: structuredClone(scan), saved: true, reviews }); preparations.set(prepared, { record, sourceRevisionId: revisionId, scan, bytes, policy: identity }); return prepared;
}
export function copyPreparedPackageScanSource(prepared: PreparedPackageScan): Blob {
  const capture = preparations.get(prepared); if (!capture) throw new Error('Open or recognize this captured source again.');
  return new Blob([capture.bytes.slice(0)], { type: capture.scan.source.type });
}
export async function preparePackageScanCorrection(prepared: PreparedPackageScan, corrected: readonly string[], policy: PolicyResolution, signal?: AbortSignal): Promise<PreparedPackageScanCorrection> {
  const capture = preparations.get(prepared), identity = policyKey(policy);
  if (!capture) throw new Error('Open or recognize this source again before reviewing corrections.');
  owner(capture.record); signal?.throwIfAborted();
  if (capture.sourceRevisionId !== capture.record.currentRevisionId) throw new Error('Historical extraction text is read-only.');
  if (corrected.length !== capture.scan.pages.length) throw new Error('Keep one corrected text value for every captured source page.');
  if (prepared.saved && corrected.every((text, index) => text === capture.scan.pages[index].text)) throw new Error('The saved extraction already matches these corrected pages.');
  const pages = capture.scan.pages.map((page, index) => ({ ...page, text: corrected[index] }));
  const scan = packageScanSchema.parse({ ...capture.scan, pages, updatedAt: Math.max(Date.now(), capture.scan.capturedAt), status: pages.some(page => page.text !== page.recognizedText) ? 'corrected' : 'recognized' });
  const current = getPackageRevision(capture.record), scans = packageScansSchema.parse({ version: 1, items: [...current.scans?.items.filter(item => item.id !== scan.id) ?? [], scan] });
  const reviews = [await sourceReview(scan, capture.bytes, policy), reviewPackageText(packageScansText(scans), 'Corrected source evidence and retained recognized text', policy)];
  signal?.throwIfAborted();
  const revision: PackageRevision = { ...structuredClone(current), id: newPackageId('revision'), parentId: current.id, createdAt: Math.max(Date.now(), scan.updatedAt, current.createdAt), outputs: [], scans };
  const after = actionPackageSchema.parse({ ...capture.record, sequence: capture.record.sequence + 1, currentRevisionId: revision.id, revisions: [...capture.record.revisions, revision] });
  const result = freeze({ scan: structuredClone(scan), reviews }); corrections.set(result, { before: capture.record, after, policy: identity }); return result;
}
export async function savePreparedPackageScan(prepared: PreparedPackageScanCorrection, policy: PolicyResolution, acknowledged: boolean,
  signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<ActionPackage> {
  const capture = corrections.get(prepared), identity = policyKey(policy);
  if (!capture || capture.policy !== identity || !acknowledged) throw new Error('Review the exact source, corrected pages and privacy findings before saving this extraction.');
  if (policyKey(await getExportDeploymentPolicy()) !== identity) throw new Error('Deployment settings changed. Review the corrections again.');
  signal?.throwIfAborted();
  const guard = () => { const actual = getExportDeploymentPolicySync(); return !signal?.aborted && isCurrent() && actual.status === 'ready' && JSON.stringify(actual.policy) === identity; };
  const saved = await commitActionPackage(capture.before, capture.after, signal, guard);
  corrections.delete(prepared); return saved;
}
/** Adoption is a separate reviewed shared-value plan; recognition and correction alone never create facts. */
export async function preparePackageScanFact(input: ActionPackage, scanId: string, pageNumber: number, label: string, excerpt: string, policy: PolicyResolution, signal?: AbortSignal) {
  const record = actionPackageSchema.parse(structuredClone(input)); owner(record); const revision = getPackageRevision(record);
  const scan = revision.scans?.items.find(scan => scan.id === scanId), page = scan?.pages.find(page => page.page === pageNumber);
  if (!scan || !page || !packageScanIsCurrent(scan, revision)) throw new Error('Use a saved extraction whose exact source member is still current before adopting a package value.');
  if (!excerpt.trim() || excerpt.length > 10_000 || !page.text.includes(excerpt)) throw new Error('Choose up to 10,000 exact characters from the saved corrected page.');
  signal?.throwIfAborted();
  const sourceBytes = await readPackageAsset(scan.source);
  await validatePackageScanSource(scan, sourceBytes);
  // Recognition can omit a source marking. A corrected excerpt does not change
  // the deployment qualification of the exact file from which it was taken.
  await sourceReview(scan, sourceBytes, policy);
  signal?.throwIfAborted();
  reviewPackageText(packageScansText({ version: 1, items: [scan] }), 'Saved extraction used for package-value adoption', policy);
  const information = structuredClone(revision.information ?? { version: 1 as const, participants: [], facts: [] });
  information.facts.push({ id: newPackageId('fact'), label, kind: 'text', value: excerpt, source: { kind: 'document', label: scan.memberLabel,
    field: `User-confirmed corrected OCR excerpt, page ${pageNumber}`, capturedAt: scan.updatedAt, sha256: scan.source.sha256 } });
  return preparePackageUpdate(record, information, revision.bindings ?? { version: 1, items: [] }, {}, policy, signal);
}
