import { officialEdition } from './nativeCatalog';
import type { OfficialInspection } from './signingBridge';

export function signatureOrderIssue(inspection: OfficialInspection, field: string, finalize: boolean,
  required?: ReadonlyMap<string, string>, returned?: OfficialInspection) {
  const selected = inspection.fields.find(slot => slot.name === field);
  if (!selected || selected.locked || selected.signed) return 'Choose an available signature field.';
  const rules: Readonly<Record<string, readonly string[]>> | undefined = officialEdition(inspection.formId, inspection.edition)?.priorSignatures;
  const earlier = new Set(rules && Object.hasOwn(rules, field) ? rules[field] : []);
  for (const name of required?.keys() ?? []) {
    if (name === field) continue;
    const covered = selected.lockFields.some(key => key === name || name.startsWith(key + '.'));
    if (finalize || selected.lockAction === 'All' || (selected.lockAction === 'Include' && covered) ||
        (selected.lockAction === 'Exclude' && !covered) || returned?.fields.some(slot => slot.name === name && slot.locked)) earlier.add(name);
  }
  const missing = [...earlier].filter(name => !inspection.fields.some(slot => slot.name === name && slot.signed && slot.trusted));
  if (missing.length) return 'Sign first: ' + missing.map(name => required?.get(name) || inspection.fields.find(slot => slot.name === name)?.label || name).join(', ') + '.';
}
