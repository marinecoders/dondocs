import type { SerializedSession } from '@/stores/documentStore';
import { withAttachmentStaging } from '@/lib/attachments';
import { configuredBatchMapping } from '@/lib/configuredFormBatch';
import { materializeSignatureFallbacks, needsSignatureFallbacks } from '@/lib/signatureCompatibility';
import { loadPackagePage } from '@/services/forms/packages';

/** Retain exact template bytes before the first row can render or the job can recover. */
export async function prepareBatchSource(source: SerializedSession, current: () => boolean): Promise<SerializedSession> {
  const owned = structuredClone(source);
  const checkCurrent = (): void => {
    if (!current()) throw new Error('Batch preparation was stopped. Resume the saved job to try again.');
  };
  checkCurrent();
  return withAttachmentStaging(async () => {
    if (owned.documentCategory === 'forms' && owned.genericForm) {
      const mapping = configuredBatchMapping(owned.genericForm);
      if (mapping.issues.length) throw new Error(mapping.issues.join('\n'));
      for (const page of owned.genericForm.definition.pages) {
        checkCurrent();
        // requireOffline retains the verified digest in the existing attachment store.
        await loadPackagePage(owned.genericForm.definition, page.file, true);
        checkCurrent();
      }
    }
    const prepared = needsSignatureFallbacks(owned) ? await materializeSignatureFallbacks(owned) : owned;
    checkCurrent();
    return prepared;
  });
}
