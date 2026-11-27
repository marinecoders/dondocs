import { officialEdition } from '@/services/forms/nativeCatalog';
import { formAssetUrl } from './releasePaths';
import { portableResourceDigest } from './portableResources';
import { loadTemplatePage, readRetainedTemplatePage } from '@/services/pdf/loadTemplatePage';
import type { PackageMember } from './actionPackages';

import type { PackageRequirements } from './packageRequirementsModel';

export function activePackageSignatureLabels(requirements: PackageRequirements | undefined, member: PackageMember) {
  const labels = new Map<string, string>();
  for (const rule of requirements?.items ?? []) {
    if (rule.kind !== 'document' || rule.condition !== 'active' || rule.memberId !== member.id ||
        !rule.operations.includes('pdf') || rule.memberRevisionId && rule.memberRevisionId !== member.revisionId) continue;
    for (const [field, label] of Object.entries(rule.completion?.signatureLabels ?? {})) labels.set(field, label);
  }
  return labels;
}

export function packageSignatureFieldLabel(member: PackageMember, field: string): string {
  const definition = member.kind === 'native' ? member.session.genericForm?.definition : undefined;
  const mapped = Object.values(definition?.fields ?? {}).find(entry => entry.sourceIds?.includes(field));
  const name = field.split('.').at(-1)?.replace(/\[\d+\]$/, '').replaceAll('_', ' ');
  return mapped?.label || name || field;
}

// Cache public edition labels only. Never retain a user's returned PDF.
const editionLabels = new Map<string, Promise<Map<string, string>>>();

export async function officialSignatureLabels(form: { id: string; edition: string }) {
  const profile = officialEdition(form.id, form.edition);
  if (!profile || profile.format === 'xfa') return;
  const cached = editionLabels.get(profile.sha256);
  if (cached) return cached;
  const pending = (async () => {
    if (profile.definitionSha256) {
      const { loadPackageFormDefinition } = await import('./packageFormFields');
      const definition = await loadPackageFormDefinition(profile);
      const labels = new Map<string, string>();
      for (const field of Object.values(definition.fields)) {
        if (field.kind === 'signature') for (const name of field.sourceIds ?? []) labels.set(name, field.label);
      }
      if (labels.size) return labels;
    }
    const bytes = await readRetainedTemplatePage(profile.sha256) ?? await loadTemplatePage(formAssetUrl(profile.directory, profile.file));
    if (await portableResourceDigest(bytes) !== profile.sha256) throw new Error('Official form edition mismatch.');
    const { readSignatureLayout } = await import('@/services/forms/signatureLayout');
    const { slots } = await readSignatureLayout(new Uint8Array(bytes));
    return new Map(slots.map(slot => [slot.name, slot.label]));
  })();
  editionLabels.set(profile.sha256, pending);
  try { return await pending; }
  catch (error) { editionLabels.delete(profile.sha256); throw error; }
}
