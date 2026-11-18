import type { PackageTemplateV2 } from './packageTemplateSchema';
import type { PackageAsset, PackageRevision } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { loadConditionalPackageSource } from './packageConditionalSources';
import { conditionalRequirementSlots } from './packageConditional';
import { packageRequirementsSchema, type PackageRequirement, type PackageRequirements } from './packageRequirementsModel';
import { sameReviewStoredValue } from './documentsDb';

/** Program declarations are derived from the exact captured template, never from a completion checkbox. */
export async function resolveConditionalPackageRequirements(revision: PackageRevision, read: (asset: PackageAsset) => Promise<ArrayBuffer> = readPackageAsset, templates?: Map<string, Promise<PackageTemplateV2>>): Promise<PackageRequirements | undefined> {
  const source = await loadConditionalPackageSource(revision, read, templates);
  if (!source) return revision.requirements;
  const slots = conditionalRequirementSlots(source.template, source.state.answers, source.state);
  const expected = packageRequirementsSchema.parse({ version: 1, items: slots.map(({ key: _key, ...item }) => item) });
  // PR8 histories precede stored requirements. Derive them on inspection so omission cannot bypass checks.
  if (revision.requirements === undefined) return expected;
  const actual = packageRequirementsSchema.parse(revision.requirements);
  const declaration = (item: PackageRequirement) => item.kind === 'document'
    ? (({ memberId: _member, ...value }) => value)(item)
    : (({ confirmed: _confirmed, ...value }) => value)(item);
  if (!sameReviewStoredValue(actual.items.map(declaration), expected.items.map(declaration)))
    throw new Error('Saved evidence requirements do not match the captured template and intake answers.');
  return actual;
}
