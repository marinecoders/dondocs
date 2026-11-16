import type { ExportArtifact } from '@/lib/exportExecution';
import { createSigningRecord } from '@/lib/signingWorkspace';
import { publishSigningCapture } from '@/lib/signingCaptureEvents';

/** This boundary receives only the artifact issued by the reviewed export. */
export async function retainSigningExport(artifact: ExportArtifact, isCurrent: () => boolean) {
  if (artifact.job.target !== 'pdf' || artifact.completeness !== 'complete' || !isCurrent()) throw new Error('A complete reviewed PDF is required for signing.');
  const record = await createSigningRecord(new Uint8Array(await artifact.blob.arrayBuffer()), artifact.job.filename, isCurrent, artifact.job.source);
  if (!isCurrent()) throw new Error('The signing capture was cancelled.');
  publishSigningCapture(record.id);return record;
}
