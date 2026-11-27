import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadOfficialFormDefinition } from '@/services/forms/officialFormDefinition';

export { loadOfficialFormDefinition as loadPackageFormDefinition } from '@/services/forms/officialFormDefinition';

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
  const definition = await loadOfficialFormDefinition(profile);
  return (id: string) => {
    const names = Object.hasOwn(definition.fields, id) && definition.fields[id].sourceIds;
    if (!names || names.length !== 1)
      throw new Error(`Expected one PDF field for ${edition.id} ${edition.edition}: ${id}.`);
    return names[0];
  };
}
