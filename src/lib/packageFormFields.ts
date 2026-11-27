import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadDefinition } from '@/services/forms/packages';
import type { FormDefinition } from '@/services/forms/model';
import { canonicalJson } from './canonicalJson';
import { portableResourceDigest } from './portableResources';

type Edition = NonNullable<ReturnType<typeof officialEdition>>;
const maxCachedDefinitions = 16;
const definitions = new Map<string, Promise<FormDefinition>>();

/** The editor and its package rules use the same verified, edition-specific field definitions. */
export async function loadPackageFormDefinition(profile: Edition): Promise<FormDefinition> {
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

/** Resolve logical IDs while building a recipe. Saved packages keep their exact PDF field names. */
export async function packageFormFields(edition: { id: string; edition: string }) {
  const profile = officialEdition(edition.id, edition.edition);
  if (!profile) throw new Error('The requested form edition is unavailable.');
  // Built-in forms and generated signature sheets declare their field names on the edition.
  const slots: Readonly<Record<string, string>> | undefined = profile.fieldIds ?? profile.signatureFieldIds;
  if (slots) return (id: string) => {
    if (!Object.hasOwn(slots, id)) throw new Error('Unknown PDF field on ' + edition.id + ': ' + id);
    return slots[id];
  };
  const definition = await loadPackageFormDefinition(profile);
  return (id: string) => {
    const names = Object.hasOwn(definition.fields, id) && definition.fields[id].sourceIds;
    if (!names || names.length !== 1)
      throw new Error(`Expected one PDF field for ${edition.id} ${edition.edition}: ${id}.`);
    return names[0];
  };
}
