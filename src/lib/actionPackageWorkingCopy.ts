import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { captureDocumentRevision } from './capturedDocument';
import { captureDocumentTarget, isCurrentDocumentTarget, openCommittedDocument, useDocumentsStore } from '@/stores/documentsStore';
import { serializeDocumentSnapshot } from './documentSerialization';
import { idbPutDocument, type StoredDocument } from './documentsDb';
import { capturePackageMember, preparePackageMember } from './actionPackageAssets';
import { commitActionPackage, getPackageRevision, newPackageId, reviseActionPackage, type ActionPackage, type NativePackageMember } from './actionPackages';
import { prepareSessionState } from '@/stores/documentStore';

export async function editPackageMember(record: ActionPackage, member: NativePackageMember): Promise<ActionPackage> {
  if (record.archived) throw new Error('Reopen this archived package before editing.');
  const target = captureDocumentTarget();
  useDocumentsStore.getState().saveCurrent();
  const { prepared, snapshot } = await preparePackageMember(member);
  if (!isCurrentDocumentTarget(target)) throw new Error('The active document changed. Reopen Packages and retry.');
  const id = newPackageId('package-working-copy'), name = `${record.name}: ${member.label} (working copy)`;
  const document: StoredDocument = { id, meta: { id, name, title: name, docType: snapshot.docType, updatedAt: Date.now(), nativeReviewText: true }, session: serializeDocumentSnapshot(snapshot, Date.now()) };
  if (!await idbPutDocument(document)) throw new Error('The package working copy could not be saved.');
  const next = await commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    workingCopies: [...(record.workingCopies ?? []).filter(copy => copy.memberId !== member.id), { memberId: member.id, documentId: id, revisionId: record.currentRevisionId }] });
  if (openCommittedDocument(prepared, document, target) !== 'applied') throw new Error('The working copy was saved to Recents. Reopen it there to continue.');
  return next;
}
export async function savePackageWorkingCopy(record: ActionPackage, member: NativePackageMember): Promise<ActionPackage> {
  const copy = record.workingCopies?.find(copy => copy.memberId === member.id);
  if (!copy || copy.documentId !== useDocumentsStore.getState().currentId || copy.revisionId !== record.currentRevisionId) throw new Error('Open the working copy for the current package revision before saving it.');
  const captured = captureCurrentDocumentRevision();
  const updated = await capturePackageMember(captured, member.label, member.role, member);
  updated.source = member.source;
  const current = getPackageRevision(record);
  return reviseActionPackage(record, current.members.map(item => item.id === member.id ? updated : item));
}
export async function adoptPackageSource(record: ActionPackage, member: NativePackageMember): Promise<ActionPackage> {
  const source = member.source?.local && useDocumentsStore.getState().docs[member.source.documentId];
  if (!source || source.meta.deletedAt) throw new Error('The library source is unavailable. The captured package member remains usable.');
  const session = structuredClone(source.session);
  const captured = captureDocumentRevision({ documentId: member.source!.documentId, epoch: 0, editSequence: 0, capturedAt: session.timestamp }, prepareSessionState(session, true));
  const updated = await capturePackageMember(captured, member.label, member.role, member);
  return reviseActionPackage(record, getPackageRevision(record).members.map(item => item.id === member.id ? updated : item));
}
