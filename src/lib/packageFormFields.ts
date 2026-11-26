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
