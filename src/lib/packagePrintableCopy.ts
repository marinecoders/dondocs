import { getExportDeploymentPolicySync } from '@/config/classification';
import { newAttachmentId } from './attachments';
import { getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type PackageMember } from './actionPackages';
import { portableResourceDigest } from './portableResources';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { inspectPackageOriginal } from './packageOriginalPdf';
import { readPackageAsset } from './actionPackageAssets';
import { loadAssemblyPdf } from '@/services/pdf/assemblyPdf';

export function requiresExternalPrint(member: Extract<PackageMember, { kind: 'original' }>) {
  return !!member.officialFormId && ['xfa', 'hybrid'].includes(officialEdition(member.officialFormId)?.format ?? '');
}

export function needsOfficialPrintableCopy(member: Extract<PackageMember, { kind: 'original' }>) {
  return !member.printableCopy && requiresExternalPrint(member);
}

/** Render the saved original into an unsigned, local review candidate. */
export async function preparePackagePrintableCopy(member: Extract<PackageMember, { kind: 'original' }>, signal: AbortSignal) {
  signal.throwIfAborted();
  if (requiresExternalPrint(member)) throw new Error('Print the completed form to PDF in a compatible viewer, then choose that file here.');
  const bytes = await readPackageAsset(member.original);
  signal.throwIfAborted();
  if (!(await inspectPackageOriginal(bytes)).printable) throw new Error('Printing is restricted for this original.');
  const { pdf } = await loadAssemblyPdf(bytes, signal, { forcePageImages: true });
  signal.throwIfAborted();
  const data = await pdf.save();
  signal.throwIfAborted();
  if (data.byteLength > 25 * 1024 * 1024) throw new Error('The prepared copy exceeds 25 MB. Upload a smaller printable PDF.');
  return new File([new Uint8Array(data)], member.original.name.replace(/\.pdf$/i, '') + '-print.pdf', { type: 'application/pdf' });
}

// Cache successful checks by content only. An aborted or failed render can be retried.
const checked = new Set<string>();
export async function checkPackagePrintablePdf(data: ArrayBuffer, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const digest = await portableResourceDigest(data);
  signal?.throwIfAborted();
  if (!checked.has(digest)) {
    if (!(await inspectPackageOriginal(data)).printable) throw new Error('Printing is restricted for this original.');
    const { pdf } = await loadAssemblyPdf(data, signal);
    if (!pdf.getPageCount()) throw new Error('The printable PDF has no pages.');
    signal?.throwIfAborted();
    if (checked.size >= 128) checked.delete(checked.values().next().value!);
    checked.add(digest);
  }
  return digest;
}

export interface ReviewedPrintableCopy {
  file: File;
  policyIdentity: string;
}

export async function setPackagePrintableCopy(record: ActionPackage, selected: PackageMember, copy: ReviewedPrintableCopy | null, signal?: AbortSignal) {
  const file = copy?.file;
  const policyCurrent = () => {
    if (!copy) return true;
    const policy = getExportDeploymentPolicySync();
    return policy.status === 'ready' && policy.policy.identity === copy.policyIdentity;
  };
  if (!policyCurrent()) throw new Error('Preview policy changed. Choose the file again.');
  const revision = getPackageRevision(record);
  const member = revision.members.find(item => item.id === selected.id);
  if (record.archived || record.reviewRounds?.some(round => !round.ownerPackageId) ||
      member?.kind !== 'original' || member.revisionId !== selected.revisionId)
    throw new Error('Reopen the current original before changing its printable copy.');
  if (file && (!/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 25 * 1024 * 1024))
    throw new Error('Choose a PDF up to 25 MB.');
  const data = file && await file.arrayBuffer();
  const asset = file && data && { id: newAttachmentId(), type: 'application/pdf' as const, name: file.name,
    size: data.byteLength, sha256: await checkPackagePrintablePdf(data, signal) };
  if (asset && asset.sha256 === member.original.sha256) throw new Error('Choose the printable export of this original.');
  if (asset?.sha256 === member.printableCopy?.asset.sha256) throw new Error('This printable copy is already saved.');
  const { printableCopy: _previous, ...source } = member;
  const replacement = { ...source, revisionId: newPackageId('member-revision'),
    ...(asset && { printableCopy: { sourceSha256: source.original.sha256, asset } }) };
  return reviseActionPackage(record, revision.members.map(item => item.id === member.id ? replacement : item),
    signal, revision.citations, policyCurrent, undefined, asset && data ? [{ ...asset, data }] : []);
}
