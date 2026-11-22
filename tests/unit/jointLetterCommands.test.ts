import { documentTextFields, mapSessionText } from '@/lib/documentFields';
import { toStore } from '../../companion/letterInput';
import { letterSchema } from '../../companion/letterSchema';
import { validateLetter } from '../../companion/validateLetter';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateBackupSession } from '@/lib/backupValidation';
import { additionalJointCommands, assertJointLetterCommandSupport, jointLetterCommandIssues } from '@/lib/jointLetterCommands';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { createSharedPayload, draftEnvelope, parseSharedSession } from '@/lib/sharedSession';
import { buildAssetSharePayload, parseSharedDocument } from '@/lib/assetShare';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';
import { requiresExtendedCorrespondenceReader } from '@/lib/documentReaderRequirements';

beforeEach(() => {
  useDocumentsStore.setState({ currentId: null, hydrated: true, docs: {}, trash: {}, baseline: null });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUIStore.setState({ storageHealth: 'ok', saveWarning: null });
});
afterEach(() => vi.restoreAllMocks());
function session() {
  const fixture = jointLetterFixture();
  return { ...createBlankSession(), ...fixture, formData: { ...createBlankSession().formData, ...fixture.formData } };
}

describe('three-command joint correspondence', () => {
  it('bounds imported commands and visibly blocks unsupported signature combinations', () => {
    const fixture = jointLetterFixture();
    const command = additionalJointCommands(fixture.formData)[0];
    expect(() => additionalJointCommands({ jointAdditionalCommands: [command, { ...command, id: 'fourth' }] })).toThrow();
    expect(() => validateBackupSession({ ...session(), formData: { jointAdditionalCommands: [command, command] } })).toThrow();
    expect(() => additionalJointCommands({ jointAdditionalCommands: [{ ...command, name: 'a'.repeat(257) }] })).toThrow();
    for (const signatureType of ['digital', 'image'] as const) {
      fixture.formData.signatureType = signatureType;
      expect(() => assertJointLetterCommandSupport('joint_letter', fixture.formData)).toThrow(/typed signatures only/);
      expect(() => generateAllLatexFiles(fixture)).toThrow(/typed signatures only/);
      expect(() => generateFlatLatex(fixture)).toThrow(/typed signatures only/);
    }
    expect(jointLetterCommandIssues('joint_letter', { jointAdditionalCommands: [{ ...command, from: '' }] })).toEqual([expect.stringContaining('From line')]);
  });
  it('does not activate retained third-command fields on a joint memorandum', () => {
    const fixture = jointLetterFixture(); fixture.docType = 'joint_memorandum';
    expect(generateFlatLatex(fixture)).not.toContain('C. MIDDLE');
    expect(Object.values(generateAllLatexFiles(fixture)).join('\n')).not.toContain('MiddleSignatoryName');
  });
  it('includes command text in search and substitution without changing identities', () => {
    const source = session();
    source.formData.jointAdditionalCommands![0].from = '{{COMMAND}}';
    expect(documentTextFields(source, 'search').map(field => field.text)).toContain('{{COMMAND}}');
    const mapped = mapSessionText(source, field => field.text.replace('{{COMMAND}}', 'Resolved command'));
    expect(mapped.formData.jointAdditionalCommands![0]).toMatchObject({ id: 'third-command', from: 'Resolved command' });
    expect(source.formData.jointAdditionalCommands![0].from).toBe('{{COMMAND}}');
    expect(documentTextFields({ ...source, docType: 'joint_memorandum' }, 'output').map(field => field.text)).not.toContain('{{COMMAND}}');
  });
  it('supports the same bounded third-command input through companion validation', () => {
    const party = { name: 'Command', from: 'Commander', signature: { name: 'C. COMMAND', title: 'Commander' } };
    const input = letterSchema.parse({ docType: 'joint_letter', subject: 'Joint action', parties: { senior: party, junior: party, additional: [party] } });
    expect(validateLetter(input)).toEqual([]);
    expect(toStore(input).formData.jointAdditionalCommands).toMatchObject([{ name: 'Command', signatureName: 'C. COMMAND' }]);
    expect(validateLetter({ ...input, docType: 'joint_memorandum' })).toContain('Additional commands are supported only for joint letters.');
    expect(validateLetter({ ...input, signature: { imageFileId: 'test' } })).toContain('Three-command joint letters support typed signatures only.');
    expect(validateLetter({ ...input, parties: { ...input.parties!, additional: [{ ...party, from: '' }] } })).toEqual([expect.stringContaining('From line')]);
  });
  it('requires the new reader even when another document type retains these fields', () => {
    for (const formData of [{ jointAdditionalCommands: additionalJointCommands(jointLetterFixture().formData) }, { letterheadMode: 'title-only' }, { letterheadMode: 'preprinted' }, { stationerySize: '7x9' }, { stationerySize: '5x7' }]) {
      expect(requiresExtendedCorrespondenceReader({ docType: 'naval_letter', formData })).toBe(true);
    }
    expect(requiresExtendedCorrespondenceReader({ formData: { letterheadMode: 'full', stationerySize: 'letter', jointAdditionalCommands: [] } })).toBe(false);
  });
  it('round-trips drafts and shares and rejects explicit older reader envelopes', async () => {
    const source = session();
    const draft = { ...source, ...draftEnvelope(source) };
    expect(draft.version).toBe(6);
    expect(parseDraftFile(draft).session.formData.jointAdditionalCommands).toEqual(source.formData.jointAdditionalCommands);
    expect(() => parseDraftFile({ ...draft, version: 5 })).toThrow(/version 6/);
    expect(() => parseDraftFile({ ...source, version: '1.1' })).toThrow(/version 6/);
    const shared = createSharedPayload(source);
    expect(shared.version).toBe(9);
    expect(parseSharedSession(shared).formData.jointAdditionalCommands).toEqual(source.formData.jointAdditionalCommands);
    expect(() => parseSharedSession({ ...shared, version: 7 })).toThrow(/version 9/);
    expect(() => parseSharedSession({ ...source, kind: 'dondocs-share', documentKind: 'correspondence', version: 1 })).toThrow(/version 6/);
    const expiry = Date.now() + 60_000;
    expect(createSharedPayload(source, expiry)).toMatchObject({ version: 9, expiresAt: expiry });
    expect(() => parseSharedSession({ kind: 'dondocs-share', version: 3, documentKind: 'correspondence', session: source, expiresAt: expiry })).toThrow(/version 9/);
    const snapshot = { ...useDocumentStore.getState().getSnapshot(), ...jointLetterFixture(), formData: source.formData };
    const portable = await buildDraftFileFromSnapshot(snapshot, Date.now());
    expect(portable).toMatchObject({ version: 6 });
    expect(parseDraftFile(portable).session.formData.jointAdditionalCommands).toEqual(source.formData.jointAdditionalCommands);
  });
  it('round-trips asset-inclusive shares and rejects a downgraded container', async () => {
    const fixture = jointLetterFixture();
    const snapshot = { ...useDocumentStore.getState().getSnapshot(), ...fixture,
      formData: { ...useDocumentStore.getState().formData, ...fixture.formData },
      enclosures: [{ title: 'Support', file: { name: 'support.pdf', size: 8, data: new TextEncoder().encode('%PDF-1.4').buffer } }] };
    const envelope = await buildAssetSharePayload(snapshot, Date.now());
    expect(envelope).toMatchObject({ version: 10 });
    expect((await parseSharedDocument(envelope)).session.formData.jointAdditionalCommands).toEqual(fixture.formData.jointAdditionalCommands);
    await expect(parseSharedDocument({ ...envelope, version: 6 })).rejects.toThrow(/version 10/);
  });
  it('preserves command data in workspace backups and rejects down-version restoration', async () => {
    const source = session();
    useDocumentsStore.setState({ docs: { joint: { meta: { id: 'joint', title: 'Joint', docType: 'joint_letter', updatedAt: 1 }, session: source } } });
    const backup = JSON.parse(await buildBackup());
    expect(backup.version).toBe(18);
    expect(backup.documents[0].session.formData.jointAdditionalCommands).toEqual(source.formData.jointAdditionalCommands);
    await expect(restoreBackup(JSON.stringify({ ...backup, version: 17 }))).rejects.toThrow(/version 18/);
    await expect(restoreBackup(JSON.stringify(backup))).resolves.toMatchObject({ documents: { imported: 1, skipped: 0 } });
  });
});
