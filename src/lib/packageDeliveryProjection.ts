import { draftEnvelope } from './sharedSession';
import { validatePackageDraft } from './actionPackageDraft';
import type { NativePackageMember, PackageAsset } from './actionPackages';
import { newPackageId } from './actionPackages';
import { readPackageMemberDraft } from './actionPackageAssets';
import { uint8ArrayToBase64 } from './encoding';
import { portableResourceDigest } from './portableResources';

export interface CapturedDeliveryAsset { asset: PackageAsset; bytes: ArrayBuffer }
const inline = (file: { name: string; data: ArrayBuffer }) => ({ name: file.name, size: file.data.byteLength, data: uint8ArrayToBase64(new Uint8Array(file.data)) });

/** Rebuild the selected native draft from parsed fields; no package history or original Word review survives. */
export async function projectEditableDeliveryMember(member: NativePackageMember): Promise<{ member: NativePackageMember; captured: CapturedDeliveryAsset }> {
  const { reviewed } = await readPackageMemberDraft(member);
  const session = structuredClone(reviewed.session);
  delete session.reviewComments; delete session.formData.wordSource;
  session.timestamp = 0;
  const envelope = session.genericForm ? { kind: 'dondocs-draft', version: 2, documentKind: 'configured-form' } : draftEnvelope(session);
  const draft = { ...envelope, ...session,
    formData: { ...session.formData, ...(reviewed.basicLetter ? { basicLetterFile: inline(reviewed.basicLetter) } : {}) },
    enclosures: session.enclosures.map((enclosure, index) => ({ ...enclosure, hasFile: !!reviewed.files[index], ...(reviewed.files[index] ? { file: inline(reviewed.files[index]!) } : {}) })),
    paragraphs: session.paragraphs.map((paragraph, index) => ({ ...paragraph, ...(paragraph.figure && reviewed.figures[index] ? { figure: { ...paragraph.figure, data: uint8ArrayToBase64(new Uint8Array(reviewed.figures[index]!.data)) } } : {}) })),
  };
  const normalized = await validatePackageDraft(draft), bytes = new TextEncoder().encode(JSON.stringify(draft)).buffer;
  const asset: PackageAsset = { id: newPackageId('delivery-draft'), name: 'editable-document.json', type: 'application/json', size: bytes.byteLength, sha256: await portableResourceDigest(bytes) };
  return { member: { id: member.id, revisionId: newPackageId('member-revision'), label: member.label, role: member.role, required: member.required,
    kind: 'native', session: normalized.session, draft: asset, ...(member.templates ? { templates: structuredClone(member.templates) } : {}) }, captured: { asset, bytes } };
}
