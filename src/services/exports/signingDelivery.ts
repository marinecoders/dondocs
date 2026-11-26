import { saveOfficialRevision } from '@/lib/officialSigning';
import type { ExportArtifact } from '@/lib/exportExecution';
import { createSigningRecord } from '@/lib/signingWorkspace';
import { publishSigningCapture } from '@/lib/signingCaptureEvents';

/** This boundary receives only the artifact issued by the reviewed export. */
export async function retainSigningExport(artifact: ExportArtifact, isCurrent: () => boolean, correspondenceCAC = false) {
  if (artifact.job.target !== 'pdf' || artifact.completeness !== 'complete' || !isCurrent()) throw new Error('A complete reviewed PDF is required for signing.');
  const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
  if (correspondenceCAC && artifact.job.kind !== 'correspondence') throw new Error('Select a correspondence draft for CAC signing.');
  if (artifact.job.officialForm || correspondenceCAC) {
    const pdf = correspondenceCAC
      ? await (await import('@/services/pdf/packageCorrespondenceSignature')).prepareCorrespondenceSignature(bytes.buffer)
      : bytes;
    const record = await saveOfficialRevision(artifact.job.filename, pdf, isCurrent, undefined, artifact.job.source);
    if (isCurrent()) publishSigningCapture(record.id);
    return record;
  }
  const record = await createSigningRecord(bytes, artifact.job.filename, isCurrent, artifact.job.source);
  if (!isCurrent()) throw new Error('The signing capture was cancelled.');
  publishSigningCapture(record.id);return record;
}
