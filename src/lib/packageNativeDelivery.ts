import type { NativePackageMember, PackageAsset } from './actionPackages';
import { preparePackageMember } from './actionPackageAssets';
import { captureDocumentRevision } from './capturedDocument';
import { captureFormExportTemplates } from './formExportTemplates';
import { prepareExport, acknowledgePreparedExport } from './preparedExport';
import type { PolicyResolution } from './exportDeploymentPolicy';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import { renderPreparedConfiguredForm } from '@/services/exports/configuredForms';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';

/** Recipient PDFs contain rendered content, excluding the editable draft and its review/source metadata. */
export async function renderPackageRecipientMember(member: NativePackageMember, policy: PolicyResolution, ports: CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> },
  read: (asset: PackageAsset) => Promise<ArrayBuffer>, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const { snapshot } = await preparePackageMember(member, read);
  delete snapshot.reviewComments; delete snapshot.formData.wordSource;
  const captured = captureDocumentRevision({ documentId: member.id, epoch: 0, editSequence: 0, capturedAt: 0 }, snapshot);
  let templates;
  if (captured.kind !== 'correspondence') {
    const pages: Record<string, Uint8Array> = {};
    for (const [file, asset] of Object.entries(member.templates ?? {})) pages[file] = new Uint8Array(await read(asset));
    templates = captureFormExportTemplates(captured.kind, snapshot.formType!, pages, snapshot.genericForm ? JSON.stringify(snapshot.genericForm.definition) : undefined);
  }
  const prepared = prepareExport({ id: `delivery_${member.id}`, captured, target: 'pdf', filename: 'member.pdf', policy, formTemplates: templates });
  if ('issues' in prepared) throw new Error(`${member.label}: ${prepared.issues.join(' ')}`);
  const ready = prepared.status === 'ready' ? prepared.job : acknowledgePreparedExport(prepared.job);
  if (ready.job.kind === 'correspondence' && !await ports.waitForReady(30_000)) throw new Error('The PDF engine is still starting. Prepare this delivery again when it is ready.');
  const artifact = ready.job.kind === 'configured-form' ? await renderPreparedConfiguredForm(ready, signal)
    : ready.job.kind === 'builtin-form' ? await renderPreparedBuiltinForm(ready, signal) : await renderPreparedCorrespondence(ready, ports, signal);
  if (artifact.completeness !== 'complete') throw new Error(artifact.issues.map(issue => issue.message).join(' '));
  signal.throwIfAborted();
  return artifact.blob.arrayBuffer();
}
