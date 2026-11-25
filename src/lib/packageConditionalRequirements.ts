import type { PackageTemplateV2 } from './packageTemplateSchema';
import type { PackageAsset, PackageRevision } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { loadConditionalPackageSource } from './packageConditionalSources';
import { packageConditionalStateSchema, type PackageConditionalState } from './packageConditionalState';
import { conditionalRequirementSlots } from './packageConditional';
import { requirementDeclaration, packageRequirementsSchema, type PackageRequirement, type PackageRequirements } from './packageRequirementsModel';
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
  const declaration = (item: PackageRequirement) => requirementDeclaration(item, true);
  if (!sameReviewStoredValue(actual.items.map(declaration), expected.items.map(declaration)))
    throw new Error('Saved evidence requirements do not match the captured template and intake answers.');
  return actual;
}


/** Capture first-save identities for PR8 drafts that predate stored requirement slots. */
export async function captureLegacyConditionalRequirementIds(revision: PackageRevision, next: PackageRequirements | undefined, read: (asset: PackageAsset) => Promise<ArrayBuffer> = readPackageAsset): Promise<{ state: PackageConditionalState; requirements: PackageRequirements } | undefined> {
  if (revision.requirements !== undefined || !revision.templateState || next === undefined) return undefined;
  const source = await loadConditionalPackageSource(revision, read);
  if (!source) return undefined;
  const submitted = packageRequirementsSchema.parse(next), reserved = new Map(source.state.requirementIds.map(item => [item.key, item.id]));
  const slots = conditionalRequirementSlots(source.template, source.state.answers, source.state);
  const declaration = (item: PackageRequirement) => {
    const { id: _id, ...value } = requirementDeclaration(item, true);
    return value;
  };
  const expected = packageRequirementsSchema.parse({ version: 1, items: slots.map(({ key: _key, ...item }) => item) });
  if (!sameReviewStoredValue(submitted.items.map(declaration), expected.items.map(declaration)))
    throw new Error('Saved evidence requirements do not match the captured template and intake answers.');
  const requirements = packageRequirementsSchema.parse({ version: 1, items: expected.items.map((item, index) => {
    const slot = slots[index], id = submitted.items[index].id, existingId = reserved.get(slot.key);
    if (existingId !== undefined && existingId !== id) throw new Error('A captured requirement identity changed. Reopen the package and review its saved declarations.');
    source.state.requirementIds.find(value => value.key === slot.key)!.id = id;
    return { ...item, id };
  }) });
  return { state: packageConditionalStateSchema.parse(source.state), requirements };
}
