import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadDefinition } from '@/services/forms/packages';
import type { FormDefinition } from '@/services/forms/model';
import { canonicalJson } from './canonicalJson';
import { portableResourceDigest } from './portableResources';

type Edition = NonNullable<ReturnType<typeof officialEdition>>;
const definitions = new Map<string, Promise<FormDefinition>>();

/** The editor and its package rules use the same verified, edition-specific field definitions. */
export async function loadPackageFormDefinition(profile: Edition): Promise<FormDefinition> {
  const hash = profile.definitionSha256;
  if (!hash) throw new Error('The selected edition has no pinned form definition.');
  let pending = definitions.get(hash);
  if (!pending) {
    pending = loadDefinition(profile.directory).then(async definition => {
      if (definition.formId !== profile.formId || definition.nativePdfEdition !== profile.edition ||
          await portableResourceDigest(new TextEncoder().encode(canonicalJson(definition)).buffer) !== hash)
        throw new Error('The form definition does not match the selected edition.');
      return definition;
    });
    definitions.set(hash, pending);
    void pending.catch(() => definitions.delete(hash));
  }
  return structuredClone(await pending);
}

/** Resolve logical IDs while building a recipe. Saved packages keep their exact PDF field names. */
export async function packageFormFields(edition: { id: string; edition: string }) {
  const profile = officialEdition(edition.id, edition.edition);
  if (!profile) throw new Error('The requested form edition is unavailable.');
  const definition = await loadPackageFormDefinition(profile);
  return (id: string) => {
    const names = Object.hasOwn(definition.fields, id) && definition.fields[id].sourceIds;
    if (!names || names.length !== 1)
      throw new Error(`Expected one PDF field for ${edition.id} ${edition.edition}: ${id}.`);
    return names[0];
  };
}
