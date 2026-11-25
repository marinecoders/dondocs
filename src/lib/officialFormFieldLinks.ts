import type { PackageMember } from './actionPackages';
import { newPackageId } from './actionPackages';
import { isEditableOfficialForm } from './packageFormEditing';
import { listPackageBindingFields, packageBindingTargetKey } from './packageBindingTargets';
import type { PackageFieldBinding } from './packageFieldBindings';

export type SharedMarineDetail = 'name' | 'edipi';
type Format = PackageFieldBinding['format'];
type Mapping = { field: string; format: Format };

// Maintainer mappings address one edition and one role. Other signers and the NJP authority are separate people.
const editions: Record<string, { edition: string; name: Mapping[]; edipi: Mapping[] }> = {
  navmc_118_11: {
    edition: '2014-05',
    name: [{ field: 'lastName', format: 'name-last' }, { field: 'firstName', format: 'name-first' }, { field: 'middleName', format: 'name-middle' }],
    edipi: [{ field: 'edipi', format: 'edipi' }],
  },
  navmc10132: {
    edition: '2023-08',
    name: [{ field: '18_accused_full_name', format: 'name-full' }],
    edipi: [{ field: '20_accused_edipi', format: 'edipi' }],
  },
};

export function officialFormMappings(member: PackageMember) {
  if (!isEditableOfficialForm(member)) return;
  const id = member.session.formType ?? '';
  const mapping = Object.hasOwn(editions, id) ? editions[id] : undefined;
  const edition = member.session.genericForm?.definition.nativePdfEdition ?? member.session.forms?.officialPdfEdition;
  return mapping && mapping.edition === edition ? mapping : undefined;
}

export async function linkOfficialFormDetail(members: readonly PackageMember[], detail: SharedMarineDetail, factId: string,
  existing: readonly PackageFieldBinding[]): Promise<PackageFieldBinding[]> {
  const additions: PackageFieldBinding[] = [];
  for (const member of members) {
    const mapping = officialFormMappings(member);
    if (!mapping) throw new Error('Choose an editable, supported official form edition.');
    const fields = await listPackageBindingFields(member);
    for (const { field, format } of mapping[detail]) {
      const target = fields.find(({ target }) => target.kind === 'page11' ? target.field === field
        : target.kind === 'configured-form' && !target.row && target.fieldId === field);
      if (!target) throw new Error(`The captured ${member.label} is missing its maintained ${field} field.`);
      const key = packageBindingTargetKey(target.target);
      const prior = existing.find(binding => binding.memberId === member.id && packageBindingTargetKey(binding.target) === key);
      if (prior) {
        if (prior.factId === factId && prior.format === format) continue;
        throw new Error(`${member.label} already has a different link for ${target.label}. Review its field links before replacing it.`);
      }
      additions.push({ id: newPackageId('binding'), mode: 'linked', factId, memberId: member.id,
        target: target.target, expectedValue: target.value, format });
    }
  }
  if (!additions.length) throw new Error('The selected fields are already linked to this package value.');
  if (existing.length + additions.length > 500) throw new Error('A package supports up to 500 field links.');
  return additions;
}
