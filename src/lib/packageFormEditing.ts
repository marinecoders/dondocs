import { readPackageMemberDraft } from './actionPackageAssets';
import { validatePackageDraft } from './actionPackageDraft';
import { getPackageRevision, listActionPackages, newPackageId, reviseActionPackage, type ActionPackage, type NativePackageMember, type PackageMember } from './actionPackages';
import { newAttachmentId } from './attachments';
import { portableResourceDigest } from './portableResources';
import type { FormInstance } from '@/services/forms/model';
import type { Navmc11811Data } from '@/stores/formStore';

export type PackageFormValues = { kind: 'configured'; answers: FormInstance['answers']; rows: FormInstance['rows'] }
  | { kind: 'page11'; page11: Navmc11811Data };

export function isEditableOfficialForm(member: PackageMember): member is NativePackageMember {
  return member.kind === 'native' && member.session.documentCategory === 'forms'
    // Legacy Page 11 signatures can carry uploaded images. The native working-copy
    // editor captures their bytes before saving the portable package draft.
    && !!(member.session.genericForm || (member.session.formType === 'navmc_118_11'
      && member.session.forms?.officialPdfEdition && member.session.forms.navmc11811));
}

export function packageFormValues(member: NativePackageMember): PackageFormValues {
  const form = member.session.genericForm;
  if (form) return { kind: 'configured', answers: form.answers, rows: form.rows };
  if (member.session.forms?.navmc11811) return { kind: 'page11', page11: member.session.forms.navmc11811 };
  throw new Error('This package member has no editable official form.');
}

/** Change only the answers in the captured draft. Original PDFs and all other members keep their asset IDs. */
export async function savePackageFormValues(record: ActionPackage, member: NativePackageMember, values: PackageFormValues, signal: AbortSignal) {
  const revision = getPackageRevision(record);
  const current = revision.members.find(item => item.id === member.id);
  if (!current || !isEditableOfficialForm(current) || current.revisionId !== member.revisionId || record.archived
      || record.workingCopies?.some(copy => copy.memberId === member.id && copy.revisionId === revision.id)
      || record.reviewRounds?.some(round => !round.ownerPackageId))
    throw new Error('This form can only be edited in its current package revision.');
  const { draft } = await readPackageMemberDraft(current);
  signal.throwIfAborted();
  const updated = { ...(draft as Record<string, unknown>), timestamp: Date.now() };
  const form = current.session.genericForm;
  if (values.kind === 'configured' && form) {
    Object.assign(updated, { genericForm: { ...form, answers: values.answers, rows: values.rows, answerRevision: form.answerRevision + 1 } });
  } else if (values.kind === 'page11' && current.session.forms?.navmc11811) {
    Object.assign(updated, { forms: { ...current.session.forms, navmc11811: values.page11 } });
  } else throw new Error('These answers do not match the selected form.');
  const { session } = await validatePackageDraft(updated);
  const data = new TextEncoder().encode(JSON.stringify(updated)).buffer;
  const asset = { ...current.draft, id: newAttachmentId(), size: data.byteLength, sha256: await portableResourceDigest(data) };
  const next = { ...current, session, draft: asset, revisionId: newPackageId('member-revision') };
  return reviseActionPackage(record, revision.members.map(item => item.id === member.id ? next : item), signal,
    revision.citations, undefined, undefined, [{ id: asset.id, name: asset.name, type: asset.type, size: asset.size, data }]);
}

/** Test the saved member identity before rebasing an edit onto other package changes. */
export async function currentPackageFormRecord(record: ActionPackage, member: NativePackageMember) {
  const latest = (await listActionPackages(record.id)).find(item => item.id === record.id);
  if (!latest || getPackageRevision(latest).members.find(item => item.id === member.id)?.revisionId !== member.revisionId)
    throw new Error('This member changed in another window. Your input is still here. Compare it with the current package before retrying.');
  return latest;
}
