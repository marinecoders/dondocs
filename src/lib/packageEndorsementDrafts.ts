import { newPackageId, type NativePackageMember, type PackageRevision } from './actionPackages';
import { readPackageMemberDraft } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { sameReviewStoredValue, type StoredAttachment } from './documentsDb';
import { planReferenceChange } from './referenceCitations';
import { referenceLetterIndex } from './referenceLetters';
import { transformRangeComments } from './reviewCommentRanges';
import { enclosureStartNumber, isEndorsement } from './endorsement';
import { documentTextFields } from './documentFields';
import { inspectEnclosureCitations } from './enclosureCitations';
import { endorsementFields, packageEndorsementRoutes } from './packageEndorsements';
import { portableResourceDigest } from './portableResources';

/** A printed number can still exist after an offset change while identifying a different enclosure. */
function checkEnclosureOffsets(member: NativePackageMember, next: number) {
  const source = member.session;
  const first = enclosureStartNumber(source.docType, source.formData.startingEnclosureNumber);
  if (first === next) return;
  for (const field of documentTextFields(source, 'output')) {
    if (field.role !== 'text' && field.role !== 'unknown') continue;
    let affected = false;
    const issues = inspectEnclosureCitations(field.text, { first, count: source.enclosures.length, inherited: true },
      (_from, to) => { if (to >= Math.min(first, next)) affected = true; });
    if (affected || issues.some(issue => issue.id.startsWith('manual:')))
      throw new Error(member.label + ': ' + field.label + ' contains an enclosure citation affected by the new routing order. Remove the affected citation, change the order, then cite its intended enclosure.');
  }
}

/** Materialize the same fields in the editor model and its portable draft before publication. */
export async function stagePackageEndorsements(revision: PackageRevision, staged: StoredAttachment[],
  prior?: PackageRevision, readDraft: (member: NativePackageMember) => Promise<{ draft: unknown }> = readPackageMemberDraft) {
  const routes = packageEndorsementRoutes(revision);
  const byId = new Map(revision.members.map(member => [member.id, member]));
  let changed = false;
  for (const [index, member] of revision.members.entries()) {
    if (member.kind !== 'native' || member.role !== 'endorsement' || !isEndorsement(member.session.docType)) continue;
    const route = routes.get(member.id);
    if (!route || member.endorsementLink && member.endorsementLink.basicMemberId !== route.basicMemberId) continue;
    const basic = byId.get(route.basicMemberId);
    if (basic?.kind !== 'native') continue;
    const existing = prior?.members.find(item => item.id === member.id);
    // Legacy entries retain their authored routing until the user links them.
    if (!member.endorsementLink && existing?.role === 'endorsement') continue;
    const fields = endorsementFields(route, basic);
    const formData = member.session.formData;
    if (!member.endorsementLink && (formData.basicLetterId?.trim() && formData.basicLetterId !== fields.basicLetterId ||
        formData.endorsementOrdinal && formData.endorsementOrdinal !== fields.endorsementOrdinal)) continue;
    const sameFields = (Object.keys(fields) as Array<keyof typeof fields>).every(key => formData[key] === fields[key]);
    if (sameFields && sameReviewStoredValue(member.endorsementLink, route)) continue;
    const next = { ...member, endorsementLink: route, revisionId: newPackageId('member-revision') };
    if (!sameFields) {
      const bytes = staged.find(asset => asset.id === member.draft.id)?.data;
      const draft: unknown = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : (await readDraft(member)).draft;
      if (!draft || typeof draft !== 'object' || !('formData' in draft)) throw new Error('The saved endorsement draft is missing its document fields.');
      checkEnclosureOffsets(member, fields.startingEnclosureNumber);
      const source = draft as typeof member.session;
      const offset = referenceLetterIndex(fields.startingReferenceLetter)!;
      const plan = planReferenceChange(source, source.references.map((_, i) => i), offset);
      if (plan.blockers.length || plan.advisories.length)
        throw new Error(member.label + ': ' + [...plan.blockers, ...plan.advisories].join(' '));
      const patched = { ...draft, ...plan.patch, formData: { ...(plan.patch.formData ?? source.formData), ...fields } };
      if (member.session.reviewComments && plan.patch.paragraphs) {
        let comments = member.session.reviewComments;
        plan.patch.paragraphs.forEach((paragraph, i) => {
          comments = transformRangeComments(comments, source.paragraphs[i], paragraph) ?? comments;
        });
        Object.assign(patched, { reviewComments: comments });
      }
      const { session } = await validatePackageDraft(patched);
      const data = new TextEncoder().encode(JSON.stringify(patched)).buffer;
      if (data.byteLength > 25 * 1024 * 1024) throw new Error('The updated endorsement exceeds the package file limit.');
      next.session = session;
      next.draft = { ...member.draft, id: newPackageId('asset'), size: data.byteLength, sha256: await portableResourceDigest(data) };
      staged.push({ ...next.draft, data });
    }
    revision.members[index] = next;
    if (!sameFields && !revision.members.some(item => item.kind === 'native' && item.draft.id === member.draft.id)) {
      const replaced = staged.findIndex(asset => asset.id === member.draft.id);
      if (replaced >= 0) staged.splice(replaced, 1);
    }
    changed = true;
  }
  return changed;
}
