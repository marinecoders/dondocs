import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadDefinition } from '@/services/forms/packages';
import type { FormDefinition } from '@/services/forms/model';
import { canonicalJson } from '@/lib/canonicalJson';
import { portableResourceDigest } from '@/lib/portableResources';

type Edition = NonNullable<ReturnType<typeof officialEdition>>;
const maxCachedDefinitions = 16;
const definitions = new Map<string, Promise<FormDefinition>>();

/** The editor and its package rules use the same verified, edition-specific field definitions. */
export async function loadOfficialFormDefinition(profile: Edition): Promise<FormDefinition> {
  const hash = profile.definitionSha256;
  if (!hash) throw new Error('The selected edition has no pinned form definition.');
  let pending = definitions.get(hash);
  if (!pending) {
    pending = loadDefinition(profile.directory).then(async definition => {
      const digest = await portableResourceDigest(new TextEncoder().encode(canonicalJson(definition)).buffer);
      // eslint-disable-next-line security/detect-possible-timing-attacks -- Both edition digests are public catalog metadata.
      if (digest !== hash)
        throw new Error('The form definition does not match the selected edition.');
      return definition;
    });
    if (definitions.size >= maxCachedDefinitions) {
      const oldest = definitions.keys().next();
      if (!oldest.done) definitions.delete(oldest.value);
    }
    definitions.set(hash, pending);
    void pending.catch(() => { if (definitions.get(hash) === pending) definitions.delete(hash); });
  }
  const definition = await pending;
  if (definition.formId !== profile.formId || definition.nativePdfEdition !== profile.edition)
    throw new Error('The form definition does not match the selected edition.');
  return structuredClone(definition);
}

/** Resolve recipe-friendly names to the exact option IDs stored in drafts and PDFs. */
export async function namedPdfChoices(edition: { id: string; edition: string }, fieldId: string) {
  const profile = officialEdition(edition.id, edition.edition);
  if (!profile) throw new Error('The requested form edition is unavailable.');
  const aliases: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined = profile.choiceAliases;
  if (!aliases || !Object.hasOwn(aliases, fieldId)) throw new Error('No named choices for field: ' + fieldId);
  const definition = await loadOfficialFormDefinition(profile);
  const field = definition.fields[fieldId];
  if (field?.kind !== 'singleChoice') throw new Error('Expected a single-choice field: ' + fieldId);
  const allowed = new Set(field.options?.map(option => option.id));
  const choices = new Map(Object.entries(aliases[fieldId]));
  for (const value of choices.values()) {
    if (!allowed.has(value)) throw new Error('Named choice does not match the selected edition: ' + fieldId);
  }
  return (name: string) => {
    const value = choices.get(name);
    if (value === undefined) throw new Error('Unknown choice for ' + fieldId + ': ' + name);
    return value;
  };
}
