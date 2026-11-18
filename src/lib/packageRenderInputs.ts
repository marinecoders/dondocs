import { readPackageAsset, readPackageMemberDraft } from './actionPackageAssets';
import type { NativePackageMember } from './actionPackages';
import { prepareSessionState } from '@/stores/documentStore';
import { supportsReviewComments } from './reviewCommentTargets';
import type { StoredAttachment } from './documentsDb';
import type { ExportAssets } from '@/services/exports/correspondence';

/** PDF preparation borrows exact captured bytes in memory. Working-copy staging
 * remains a separate operation that deliberately installs durable editor files. */
export async function preparePackageRenderInput(member: NativePackageMember, read: typeof readPackageAsset = readPackageAsset) {
  const { reviewed } = await readPackageMemberDraft(member, read);
  const snapshot = prepareSessionState(reviewed.session, supportsReviewComments(reviewed.session));
  const figures = new Map<string, StoredAttachment>();
  if (reviewed.basicLetter) snapshot.formData.basicLetterFile = structuredClone(reviewed.basicLetter);
  for (const [index, file] of reviewed.files.entries()) if (file) snapshot.enclosures[index].file = structuredClone(file);
  for (const [index, file] of reviewed.figures.entries()) {
    if (!file) continue;
    const figure = snapshot.paragraphs[index]?.figure;
    if (!figure) throw new Error('The captured figure has no matching document position.');
    const id = `pkg-figure-${index}`;
    figures.set(id, { id, name: file.name, type: figure.type ?? 'image/png', size: file.data.byteLength, data: file.data.slice(0) });
    figure.fileRef = { id, name: file.name, size: file.data.byteLength, type: figure.type ?? 'image/png' };
  }
  const assets: ExportAssets = {
    async withAssets(ids, operation) {
      const requested = new Set(ids);
      if ([...requested].some(id => !figures.has(id))) throw new Error('The renderer requested a file outside its captured package member.');
      let active = true;
      try { return await operation(id => {
        if (!active || !requested.has(id)) throw new Error('This file is outside the current captured render scope.');
        return structuredClone(figures.get(id)!);
      }); } finally { active = false; }
    },
  };
  return { snapshot, assets };
}
