import type { ActionPackage, PackageMember } from './actionPackages';
import { identifyOfficialOriginal, officialEdition } from '@/services/forms/nativeCatalog';
import { officialRevisionBytes, officialSigningRecords, type OfficialSigningRecord } from './officialSigning';
import type { OfficialInspection } from '@/services/forms/signingBridge';
import { portableResourceDigest } from './portableResources';

export function signingMemberKey(packageId: string, member: PackageMember) {
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify([packageId, member.id, member.revisionId])).buffer);
}

/** Give each unsigned handoff a distinct byte prefix, even for identical answers in two slots.
 * Insert a PDF comment after the last xref object, preserving object offsets and the publisher prefix. */
export function bindUnsignedFormPdf(bytes: Uint8Array, editionLength: number, key: string) {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(-256));
  const eof = /startxref\s+\d+\s+%%EOF\s*$/.exec(tail);
  const offset = bytes.length - tail.length + (eof?.index ?? 0);
  if (!/^[a-f0-9]{64}$/.test(key) || !eof || offset < editionLength)
    throw new Error('Fill the official form before starting a package signing handoff.');
  const marker = new TextEncoder().encode('% DonDocs handoff ' + key + '\n');
  const result = new Uint8Array(bytes.length + marker.length);
  result.set(bytes.subarray(0, offset));
  result.set(marker, offset);
  result.set(bytes.subarray(offset), offset + marker.length);
  return result;
}

export async function checkPackageFormReturn(record: ActionPackage, member: PackageMember, saved: OfficialSigningRecord,
  expected: { id: string; base: string; documentId: string }, inspection: OfficialInspection) {
  const current = (await officialSigningRecords()).find(item => item.id === saved.id);
  if (!current || current.revisions.length !== saved.revisions.length || current.revisions.at(-1)?.sha256 !== inspection.sha256 ||
      expected.documentId !== await signingMemberKey(record.id, member) || saved.id !== expected.id || saved.sourceRevision?.documentId !== expected.documentId ||
      saved.revisions.length < 2 || saved.revisions[0].sha256 !== expected.base ||
      inspection.sha256 !== saved.revisions.at(-1)?.sha256)
    throw new Error('Reopen the signing handoff for this document revision.');
  const formId = member.kind === 'native' ? member.session.formType : member.kind === 'original' ? member.officialFormId : undefined;
  const fields = inspection.fields.filter(field => field.signed);
  if (inspection.formId !== formId || !officialEdition(inspection.formId, inspection.edition) ||
      !fields.length || fields.some(field => !field.trusted))
    throw new Error('The returned official form needs a verified signature in every signed field.');
  if (member.kind === 'original' && (member.original.sha256 !== expected.base || record.revisions.some(revision =>
    revision.members.some(other => other.id !== member.id && other.kind === 'original' && other.original.sha256 === expected.base))))
    throw new Error('The signed source cannot be uniquely associated with this package member.');
  const bytes = await officialRevisionBytes(saved);
  await officialRevisionBytes(saved, 0);
  if (await identifyOfficialOriginal(bytes.buffer) !== formId) throw new Error('The returned PDF belongs to a different form.');
  return bytes;
}
