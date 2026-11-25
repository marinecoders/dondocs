import type { NativePackageMember, PackageAsset } from './actionPackages';
import { preparePackageRenderInput } from './packageRenderInputs';
import { captureDocumentRevision } from './capturedDocument';
import { captureFormExportTemplates } from './formExportTemplates';
import { prepareExport, acknowledgePreparedExport, copyExportReview, type ExportReview } from './preparedExport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import { renderPreparedConfiguredForm } from '@/services/exports/configuredForms';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';

/** Recipient PDFs contain rendered content, excluding the editable draft and its review/source metadata. */
export async function renderPackageRecipientMember(member: NativePackageMember, policy: PolicyResolution, ports: (CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> }) | undefined,
  read: (asset: PackageAsset) => Promise<ArrayBuffer>, signal: AbortSignal, pdfAccessibility?: 'tagged', mode: 'printable' | 'editable' = 'printable'): Promise<{ bytes: ArrayBuffer; layoutReview?: ExportReview }> {
  signal.throwIfAborted();
  const { snapshot, assets } = await preparePackageRenderInput(member, read);
  delete snapshot.reviewComments; delete snapshot.formData.wordSource;
  const captured = captureDocumentRevision({ documentId: member.id, epoch: 0, editSequence: 0, capturedAt: 0 }, snapshot);
  let templates;
  if (captured.kind !== 'correspondence') {
    if (pdfAccessibility) throw new Error(`${member.label}: Tagged PDF is unavailable for this form. Exclude it or prepare an ordinary delivery.`);
    const pages: Record<string, Uint8Array> = {};
    for (const [file, asset] of Object.entries(member.templates ?? {})) pages[file] = new Uint8Array(await read(asset));
    templates = captureFormExportTemplates(captured.kind, snapshot.formType!, pages, snapshot.genericForm ? JSON.stringify(snapshot.genericForm.definition) : undefined);
  }
  const prepared = prepareExport({ id: `delivery_${member.id}`, captured, target: 'pdf', filename: 'member.pdf', policy, formTemplates: templates, pdfAccessibility });
  if ('issues' in prepared) throw new Error(`${member.label}: ${prepared.issues.join(' ')}`);
  const review = prepared.status === 'needs-review' ? copyExportReview(prepared.job) : undefined;
  // The internal derivative is needed to inspect the delivery before the user approves its download.
  const ready = prepared.status === 'ready' ? prepared.job : acknowledgePreparedExport(prepared.job);
  if (ready.job.kind === 'correspondence' && (!ports || !await ports.waitForReady(30_000))) throw new Error('The PDF engine is still starting. Prepare this delivery again when it is ready.');
  const artifact = ready.job.kind === 'configured-form' ? await renderPreparedConfiguredForm(ready, signal, mode)
    : ready.job.kind === 'builtin-form' ? await renderPreparedBuiltinForm(ready, signal, mode) : await renderPreparedCorrespondence(ready, { ...ports!, assets }, signal);
  if (artifact.completeness !== 'complete') throw new Error(artifact.issues.map(issue => issue.message).join(' '));
  signal.throwIfAborted();
  return { bytes: await artifact.blob.arrayBuffer(), layoutReview: review?.layoutReview ? review : undefined };
}
