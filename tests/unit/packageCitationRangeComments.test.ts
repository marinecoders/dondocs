import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type NativePackageMember } from '@/lib/actionPackages';
import { initializePackageCitationTargets, linkPackageCitation, packageCitationCandidates, packageCitationOccurrences, resolvePackageCitations } from '@/lib/packageCitations';
import { preparePackageCitationReorder, applyPackageCitationReorder } from '@/lib/packageCitationReorder';
import { preparePackageCitationRepair, applyPackageCitationRepair } from '@/lib/packageCitationRepair';
import { commitPackageCitationRevision } from '@/lib/packageCitationRevision';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { referenceLetterAt } from '@/lib/referenceLetters';
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
async function fixture(referenceCount = 2) {
  const session = createBlankSession();
  session.references = Array.from({ length: referenceCount }, (_, index) => ({ letter: referenceLetterAt(index), title: `Synthetic reference ${index}` }));
  session.paragraphs = [{ id: 'citation-range-body', text: 'Prefix reference (a) Suffix.', level: 0 }];
  const selections = [[0, 6], [18, 19], [21, 27]];
  session.reviewComments = { version: 3, threads: selections.map(([start, end], index) => ({ id: crypto.randomUUID(), anchor: captureTextRange(session, 'citation-range-body', start, end)!, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Synthetic reviewer', text: `Retained range ${index}`, createdAt: new Date().toISOString() }] })) };
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'citation-range-source', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Range citation member', 'basic-letter');
  let record = await initializePackageCitationTargets(await reviseActionPackage(await createActionPackage('Citation range retention'), [native]));
  const revision = getPackageRevision(record), occurrence = (await packageCitationOccurrences(revision))[0];
  record = await linkPackageCitation(record, occurrence.source, revision.citations!.targets.find(target => target.kind === 'reference' && target.index === 0)!.id);
  return { record, native };
}
function currentNative(record: Awaited<ReturnType<typeof fixture>>['record']): NativePackageMember {
  const native = getPackageRevision(record).members[0]; if (native.kind !== 'native') throw new Error('Expected native citation member'); return native;
}
it('maps untouched selected comments and detaches a rewritten citation through reorder, inverse revision and reload', async () => {
  const { record, native } = await fixture(27), order = Array.from({ length: 27 }, (_, index) => index);
  [order[0], order[26]] = [order[26], order[0]];
  const prepared = await preparePackageCitationReorder(record, { kind: 'references', memberId: native.id, order }, policy);
  const changed = await applyPackageCitationReorder(prepared), member = currentNative(changed);
  expect(member.session.paragraphs[0].text).toBe('Prefix reference (a0) Suffix.');
  const threads = member.session.reviewComments!.threads;
  expect(resolveTextRange(member.session, threads[0].anchor as NonNullable<ReturnType<typeof captureTextRange>>)).toMatchObject({ status: 'current', start: 0, end: 6, text: 'Prefix' });
  expect(resolveTextRange(member.session, threads[2].anchor as NonNullable<ReturnType<typeof captureTextRange>>)).toMatchObject({ status: 'current', start: 22, end: 28, text: 'Suffix' });
  expect(threads[1].anchor).toMatchObject({ context: 'Prefix reference (a) Suffix.', start: 18, end: 19, detached: true });
  expect(threads.map(thread => thread.messages)).toEqual(native.session.reviewComments!.threads.map(thread => thread.messages));
  expect(changed.revisions.slice(0, -1)).toEqual(record.revisions);
  expect((await readPackageMemberDraft(member)).reviewed.session.reviewComments).toEqual(member.session.reviewComments);
  expect((await resolvePackageCitations(getPackageRevision(changed))).links.every(link => link.state === 'current')).toBe(true);
  const inverted = await applyPackageCitationReorder(await preparePackageCitationReorder(changed, { kind: 'references', memberId: native.id, order }, policy)), restored = currentNative(inverted);
  expect(restored.session.paragraphs[0].text).toBe('Prefix reference (a) Suffix.');
  expect(resolveTextRange(restored.session, restored.session.reviewComments!.threads[2].anchor as NonNullable<ReturnType<typeof captureTextRange>>)).toMatchObject({ status: 'current', text: 'Suffix' });
  expect(restored.session.reviewComments!.threads[1].anchor).toMatchObject({ detached: true });
  expect(inverted.revisions.slice(0, -1)).toEqual(changed.revisions);
  expect((await listActionPackages()).find(value => value.id === inverted.id)).toEqual(inverted);
});
it('maps comments for a deliberate citation repair and keeps the caller comment guard strict', async () => {
  const { record, native } = await fixture(), revision = getPackageRevision(record), occurrence = (await packageCitationOccurrences(revision))[0];
  const target = (await packageCitationCandidates(revision)).find(candidate => candidate.target.kind === 'reference' && candidate.target.index === 1)!;
  const prepared = await preparePackageCitationRepair(record, { kind: 'relink', linkId: revision.citations!.links[0].id, source: occurrence.source, target: target.target }, policy);
  const changed = await applyPackageCitationRepair(prepared), member = currentNative(changed), comments = member.session.reviewComments!;
  expect(member.session.paragraphs[0].text).toBe('Prefix reference (b) Suffix.');
  expect(resolveTextRange(member.session, comments.threads[0].anchor as NonNullable<ReturnType<typeof captureTextRange>>).status).toBe('current');
  expect(resolveTextRange(member.session, comments.threads[2].anchor as NonNullable<ReturnType<typeof captureTextRange>>).status).toBe('current');
  expect(comments.threads[1].anchor).toMatchObject({ context: 'Prefix reference (a) Suffix.', detached: true });
  expect(changed.revisions.slice(0, -1)).toEqual(record.revisions);
  const forged = structuredClone(member.session); forged.paragraphs[0].text = 'Prefix reference (a) Suffix.'; forged.reviewComments!.threads[0].messages[0].text = 'Forbidden discussion rewrite';
  await expect(commitPackageCitationRevision(changed, [native.id], new Map([[native.id, forged]]), async () => getPackageRevision(changed).citations!, policy)).rejects.toThrow(/Citation edits may change/);
  expect((await listActionPackages()).find(value => value.id === changed.id)).toEqual(changed);
});
