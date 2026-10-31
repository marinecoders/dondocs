import { sl3Schema } from '@/data/techpub/sl3';
import { parseFormInstance } from '@/services/forms/model';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_ITEMS = 100_000;
type RecordValue = Record<string, unknown>;
function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as RecordValue;
}
function strings(value: RecordValue, keys: string[], label: string) {
  for (const key of keys) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`Invalid ${label}.${key}`);
}
export function validateBackupSession(value: unknown) {
  const data = object(value, 'session');
  for (const key of ['formData', 'publicationTables']) if (data[key] !== undefined) object(data[key], key);
  for (const key of ['enclosures', 'paragraphs', 'references', 'endItems', 'copyTos', 'distributions']) if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Invalid session.${key}`);
  const formData = data.formData as RecordValue | undefined;
  if (formData?.sl3 !== undefined) sl3Schema.parse(formData.sl3);
  if (data.genericForm) {
    const form = parseFormInstance(data.genericForm);
    if (data.documentCategory !== 'forms' || data.formType !== form.definition.formId) throw new Error('Form type does not match the saved definition');
  }
}

/** Validate present fields; older backups may legitimately omit newer sections. */
export function validateBackup(data: RecordValue): void {
  // Bound traversal and reject dictionary keys that can affect object prototypes.
  let items = 0;
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 50 || ++items > MAX_ITEMS) throw new Error('Backup is too complex to import');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid backup key');
      visit(child, depth + 1);
    }
  };
  visit(data);
  for (const key of ['version', 'exportedAt']) if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]))) throw new Error(`Invalid ${key}`);
  for (const key of ['documents', 'snippets', 'attachments']) if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Invalid ${key}`);
  for (const document of (data.documents ?? []) as unknown[]) validateBackupSession(object(document, 'document').session);
  if (data.profiles !== undefined) {
    const profiles = object(data.profiles, 'profiles');
    const records = object(profiles.profiles, 'profile records');
    if (profiles.selectedProfile !== undefined && profiles.selectedProfile !== null && typeof profiles.selectedProfile !== 'string') throw new Error('Invalid selected profile');
    for (const value of Object.values(records)) {
      const profile = object(value, 'profile');
      strings(profile, ['department', 'unitLine1', 'unitLine2', 'unitAddress', 'ssic', 'from', 'sigFirst', 'sigMiddle', 'sigLast', 'sigRank', 'sigTitle', 'officeCode', 'byDirectionAuthority', 'cuiControlledBy', 'pocEmail', 'signatureType'], 'profile');
      if (profile.byDirection !== undefined && typeof profile.byDirection !== 'boolean') throw new Error('Invalid profile.byDirection');
      if (profile.signatureImage !== undefined && profile.signatureImage !== null) {
        const image = object(profile.signatureImage, 'signature image');
        if (typeof image.data !== 'string' || typeof image.name !== 'string' || typeof image.size !== 'number' || !Number.isFinite(image.size)) throw new Error('Invalid signature image');
      }
    }
  }
  const ids = new Set<string>();
  for (const value of (data.snippets ?? []) as unknown[]) {
    const snippet = object(value, 'snippet');
    if (typeof snippet.id !== 'string' || !snippet.id || typeof snippet.name !== 'string' || typeof snippet.text !== 'string' || ids.has(snippet.id)) throw new Error('Invalid or duplicate snippet');
    ids.add(snippet.id);
  }
  if (data.userTemplates !== undefined) for (const [id, value] of Object.entries(object(data.userTemplates, 'templates'))) {
    const template = object(value, 'template');
    if (template.id !== id || typeof template.name !== 'string' || typeof template.docType !== 'string' || typeof template.createdAt !== 'number' || !Number.isFinite(template.createdAt)) throw new Error('Invalid template');
    validateBackupSession(template.session);
  }
  if (data.routingOverrides !== undefined) {
    for (const value of Object.values(object(data.routingOverrides, 'routing overrides'))) if (typeof value !== 'string') throw new Error('Invalid routing override');
  }
  if (data.forms !== undefined) {
    const forms = object(data.forms, 'forms');
    if (forms.includeCoverPage !== undefined && typeof forms.includeCoverPage !== 'boolean') throw new Error('Invalid cover page setting');
    for (const key of ['navmc10274', 'navmc11811']) {
      if (forms[key] === undefined || forms[key] === null) continue;
      const form = object(forms[key], key);
      for (const [field, value] of Object.entries(form)) {
        if (field === 'signatureBlocks') {
          if (!Array.isArray(value)) throw new Error('Invalid signature blocks');
          for (const entry of value) {
            const block = object(entry, 'signature block');
            strings(block, ['name', 'statement', 'style', 'image'], 'signature block');
            if (block.digital !== undefined && typeof block.digital !== 'boolean') throw new Error('Invalid legacy signature');
          }
        } else if (typeof value !== 'string') throw new Error(`Invalid ${key}.${field}`);
      }
    }
    const values = (value: unknown) => {
      for (const answer of Object.values(object(value, 'form answers'))) if (typeof answer !== 'string' && typeof answer !== 'boolean') throw new Error('Invalid form answer');
    };
    if (forms.configFormValues !== undefined) for (const value of Object.values(object(forms.configFormValues, 'form values'))) values(value);
    if (forms.configFormRows !== undefined) for (const form of Object.values(object(forms.configFormRows, 'form rows'))) {
      for (const rows of Object.values(object(form, 'row groups'))) {
        if (!Array.isArray(rows)) throw new Error('Invalid rows');
        rows.forEach(values);
      }
    }
  }
}
