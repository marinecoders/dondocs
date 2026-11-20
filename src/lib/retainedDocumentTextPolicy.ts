import { documentTextFields, type DocumentFieldSource } from './documentFields';
import { retainedTextClassificationLevel } from './detectClassification';
import { assertExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { assertEnclosureMarkingPolicy } from './enclosureMarkings';

/** The transfer text inventory includes inactive, unknown and definition text.
 * Keep this independent of rendered output and report comparison projections.
 * Declared structured/custom marking validation remains the caller's separate gate.
 */
export function assertRetainedTextPolicy(texts: Iterable<string>, policy: PolicyResolution): void {
  if (policy.status !== 'ready') throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  for (const text of texts) {
    if (!policy.policy.allowedLevels.includes(retainedTextClassificationLevel(text))) {
      throw new Error('This shared document includes retained text markings outside this deployment’s configured levels.');
    }
  }
}

export function assertRetainedDocumentTextPolicy(source: DocumentFieldSource, policy: PolicyResolution): void {
  assertEnclosureMarkingPolicy(source, policy);
  assertRetainedTextPolicy(documentTextFields(source, 'share', { includeUnknownDataUris: true }).map(field => field.text), policy);
}
