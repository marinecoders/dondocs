import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { signingMemberKey } from '@/lib/packageFormReturn';
import { saveOfficialRevision } from '@/lib/officialSigning';
import { packageReturnCandidates } from '@/lib/packageReturnCandidates';

it('matches the exact current member and refuses similar names, older revisions and unrelated cases', async () => {
  const empty = createBlankSession();
  const document = captureDocumentRevision({ documentId: 'synthetic', epoch: 0, editSequence: 0, capturedAt: 1 }, { ...empty, endItems: [], publicationTables: {} });
  const members = await Promise.all([1, 2].map(() => capturePackageMember(document, 'Same filename', 'enclosure')));
  const packageId = crypto.randomUUID(), signal = new AbortController().signal;
  const revision = { id: 'version', createdAt: 1, members, outputs: [] };
  const records = await Promise.all(members.map(async (member, index) => saveOfficialRevision('return.pdf', new Uint8Array([1, index]), () => true, undefined, {
    documentId: await signingMemberKey(packageId, member), epoch: 0, editSequence: 0, capturedAt: 1,
  })));
  const bytes = new Uint8Array([1, 1, 3, 4]).buffer;
  expect(await packageReturnCandidates(packageId, revision, bytes, records, signal)).toEqual([{member: members[1], recordId: records[1].id}]);
  expect(await packageReturnCandidates('other-case', revision, bytes, records, signal)).toEqual([]);
  expect(await packageReturnCandidates(packageId, { ...revision, members: [{ ...members[1], revisionId: 'new' }] }, bytes, records, signal)).toEqual([]);
  expect(await packageReturnCandidates(packageId, revision, new Uint8Array([1,1]).buffer, records, signal)).toEqual([]);
  const duplicate = { ...records[1], id: 'other-record' };
  expect(await packageReturnCandidates(packageId, revision, bytes, [records[1], duplicate], signal)).toHaveLength(2);
});
