import formEditions from '@/data/officialPdfEditions.json';
import references from '@/data/packageReferenceEditions.json';
import { formAssetUrl } from './releasePaths';
import { portableResourceDigest } from './portableResources';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { loadTemplatePage } from '@/services/pdf/loadTemplatePage';

interface ReferenceEdition { id: string; edition: string; name: string; directory: string; file: string; sha256: string; requiresDesktopReader?: boolean }
const catalog: readonly ReferenceEdition[] = [...references, ...formEditions.map(form => ({
  id: form.formId, edition: form.edition, name: form.label + '.pdf', directory: form.directory, file: form.file, sha256: form.sha256,
}))];

export async function loadPackageBlank(id: string, edition: string) {
  const source = catalog.find(item => item.id === id && item.edition === edition);
  if (!source) throw new Error('The requested reference edition is unavailable.');
  const bytes = await loadTemplatePage(formAssetUrl(source.directory, source.file));
  if (await portableResourceDigest(bytes) !== source.sha256) throw new Error('The reference PDF does not match its catalog edition.');
  return { blankPdf: { name: source.name, type: 'application/pdf' as const, data: uint8ArrayToBase64(new Uint8Array(bytes)) },
    completion: { blankSha256: source.sha256 } };
}

export async function readPackageBlank(blank: { name: string; data: string }) {
  const bytes = new Uint8Array(base64ToUint8Array(blank.data)).buffer;
  const digest = await portableResourceDigest(bytes);
  if (!catalog.some(item => item.name === blank.name && item.sha256 === digest)) throw new Error('The saved PDF does not match a catalog edition.');
  return bytes;
}

/** Captured blank digests identify the verified catalog edition across renames and transfer. */
export function desktopPackageBlank(sha256?: string) {
  return catalog.some(edition => edition.sha256 === sha256 && edition.requiresDesktopReader === true);
}
