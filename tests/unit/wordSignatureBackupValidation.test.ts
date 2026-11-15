import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { restoreBackup } from '@/lib/backup';
import { idbDeleteDocument, idbGetAllDocuments, idbPutDocument } from '@/lib/documentsDb';
import { importLibrary, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import type { SerializedSession } from '@/stores/documentStore';
import { validateBackupSession } from '@/lib/backupValidation';

function record(signer: unknown, updatedAt = 1, id = 'word-signature-restore') {
  const session = {
    documentMode: 'custom', documentCategory: 'correspondence', docType: 'joint_letter',
    formType: 'navmc_10274', formData: { subject: 'SYNTHETIC RESTORE', signatureImageSigner: signer },
    references: [], enclosures: [], paragraphs: [{ id: 'body', level: 0, text: 'Synthetic retained work.' }],
    copyTos: [], distributions: [], endItems: [], publicationTables: {}, timestamp: updatedAt,
  } as unknown as SerializedSession;
  return { id, meta: { id, title: 'Synthetic restore',
    docType: 'joint_letter', updatedAt, createdAt: 1 }, session };
}

beforeEach(async () => {
  for (const document of await idbGetAllDocuments() ?? []) await idbDeleteDocument(document.id);
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null, hydrated: true });
});

it.each(['both', 'Senior', '', null, 1, {}])('rejects malformed backup signer %j', signer => {
  expect(() => validateBackupSession(record(signer).session)).toThrow(/signer/i);
});

for (const format of ['workspace', 'library'] as const) {
  it.each([undefined, 'junior', 'senior'])('retains valid %s signer through ' + format + ' restore', async signer => {
    const incoming = record(signer);
    const result = format === 'workspace'
      ? (await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 12, documents: [incoming] }))).documents
      : await importLibrary(JSON.stringify({ docs: [incoming] }));
    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect((await idbGetAllDocuments())![0].session.formData.signatureImageSigner).toBe(signer);
    expect(openExistingDocument(incoming.id)).toBe('applied');
  });

  it('preflights every ' + format + ' record before committing a valid earlier record', async () => {
    const original = record('junior');
    await idbPutDocument(original);
    const incoming = [record('senior', 2, 'valid-first'), record('both', 2)];
    const restore = format === 'workspace'
      ? restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 12, documents: incoming }))
      : importLibrary(JSON.stringify({ docs: incoming }));
    await expect(restore).rejects.toThrow(/signer/i);
    expect(await idbGetAllDocuments()).toEqual([original]);
  });
}

it.each(['history', 'template'] as const)('validates signer in restored %s sessions before document writes', async owner => {
  const invalid = record('both').session;
  const section = owner === 'history'
    ? { snapshots: { history: [{ ts: 1, session: invalid }] } }
    : { userTemplates: { template: { id: 'template', name: 'Synthetic template', docType: 'joint_letter', createdAt: 1, session: invalid } } };
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 12,
    documents: [record('senior')], ...section }))).rejects.toThrow(/signer/i);
  expect(await idbGetAllDocuments()).toEqual([]);
});

it.each(['workspace', 'library'] as const)('rejects an invalid signer before %s restore replaces usable work', async format => {
  const original = record('junior');
  await idbPutDocument(original);
  useDocumentsStore.setState({ docs: { [original.id]: { meta: original.meta, session: original.session } } });
  const incoming = record('both', 2);
  const restore = format === 'workspace'
    ? restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 12, documents: [incoming] }))
    : importLibrary(JSON.stringify({ docs: [incoming] }));
  await expect.soft(restore).rejects.toThrow(/signer/i);
  expect.soft(await idbGetAllDocuments()).toEqual([original]);
  expect(openExistingDocument(original.id)).toBe('applied');
});
