// End-to-end proof that a full-account backup saves EVERYTHING and restores it:
// documents, profiles (INCLUDING the uploaded signature image), snippets, user
// templates, in-progress NAVMC form fields, and enclosure file bytes. Populates
// every persisted store, builds a real backup, WIPES every store + IndexedDB,
// then restores from the bundle and asserts each piece came back byte-for-byte.
//
// This is the regression guard for "backup is silently lossy" — if any store is
// ever dropped from buildBackup/restoreBackup, exactly one assertion here fails.

// A real (in-memory) IndexedDB must exist before documentsDb evaluates. First import.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { persistAttachment, loadAttachment } from '@/lib/attachments';
import {
  idbGetAllDocuments,
  idbDeleteDocument,
  idbGetAllAttachments,
  idbDeleteAttachment,
  idbAddSnapshot,
  idbGetSnapshots,
  idbDeleteSnapshots,
} from '@/lib/documentsDb';
import { useProfileStore } from '@/stores/profileStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useFormStore } from '@/stores/formStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import type { Profile } from '@/types/document';
import type { SerializedSession } from '@/stores/documentStore';

const session = (over: Partial<SerializedSession> = {}): SerializedSession => ({
  documentMode: 'compliant',
  documentCategory: 'correspondence',
  docType: 'naval_letter',
  formType: 'navmc_10274',
  formData: {},
  references: [],
  enclosures: [],
  paragraphs: [],
  copyTos: [],
  distributions: [],
  timestamp: 1,
  ...over,
});

// A distinctive base64 "signature image" — the exact field silently lost before
// the full-account backup existed. Must survive the JSON round-trip intact.
const SIGNATURE_B64 = btoa('SIGNATURE-IMAGE-BYTES-þÿ');

const testProfile: Profile = {
  unitLine1: '1st Battalion, 5th Marines',
  unitLine2: '1st Marine Division',
  unitAddress: 'BOX 555, CAMP PENDLETON CA 92055',
  ssic: '5216',
  from: 'Commanding Officer, 1st Bn, 5th Mar',
  sigFirst: 'John',
  sigMiddle: 'Q',
  sigLast: 'Doe',
  sigRank: 'LtCol',
  sigTitle: 'Commanding Officer',
  signatureType: 'image',
  signatureImage: { name: 'sig.png', size: 42, data: SIGNATURE_B64 },
};

async function wipeEverything(): Promise<void> {
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useSnippetsStore.setState({ snippets: [] });
  useUserTemplatesStore.setState({ templates: {} });
  useFormStore.setState((s) => ({
    navmc10274: { ...s.navmc10274, ssicFileNo: 'WIPED' },
    navmc11811: { ...s.navmc11811 },
  }));
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true });
  for (const a of (await idbGetAllAttachments()) ?? []) await idbDeleteAttachment(a.id);
  for (const d of (await idbGetAllDocuments()) ?? []) {
    await idbDeleteSnapshots(d.id);
    await idbDeleteDocument(d.id);
  }
}

describe('full-account backup round-trip (saves EVERYTHING)', () => {
  beforeEach(() => {
    useUIStore.setState({ storageHealth: 'ok' }); // exportLibrary refuses on 'unreadable'
  });

  it('backs up and restores every store — documents, profiles+signature, snippets, templates, forms, enclosures', async () => {
    // ── Populate every persisted store with distinctive data ──────────────────
    const sigBytes = new Uint8Array([1, 2, 3, 4, 250, 128, 0, 77]);
    const fileRef = await persistAttachment(
      { name: 'orders.pdf', size: sigBytes.length, type: 'application/pdf' },
      sigBytes.buffer
    );

    useProfileStore.setState({ profiles: { 'Test CO': testProfile }, selectedProfile: 'Test CO' });
    useSnippetsStore.setState({ snippets: [{ id: 'snip-1', name: 'IAW opener', text: 'In accordance with reference (a)...' }] });
    useUserTemplatesStore.setState({
      templates: { 'tpl-1': { id: 'tpl-1', name: 'My Template', docType: 'naval_letter', createdAt: 123, session: session() } },
    });
    useFormStore.setState((s) => ({
      navmc10274: { ...s.navmc10274, ssicFileNo: 'SSIC-10274-MARKER', supplementalInfo: 'counseling text' },
      navmc11811: { ...s.navmc11811 },
    }));
    useDocumentsStore.setState({
      hydrated: true,
      currentId: 'doc-1',
      docs: {
        'doc-1': {
          meta: { id: 'doc-1', title: 'Test Letter', docType: 'naval_letter', updatedAt: 1000 },
          session: session({
            formData: { subject: 'PROMOTION RECOMMENDATION' },
            enclosures: [{ title: 'Reference Orders', hasFile: true, fileRef }],
          }),
        },
      },
    });

    // ── Build the backup, then confirm the bundle actually carries each store ──
    const json = await buildBackup();
    const bundle = JSON.parse(json);
    expect(bundle.kind).toBe('dondocs-backup');
    expect(bundle.documents).toHaveLength(1);
    expect(bundle.profiles.profiles['Test CO'].signatureImage.data).toBe(SIGNATURE_B64);
    expect(bundle.snippets).toHaveLength(1);
    expect(Object.keys(bundle.userTemplates)).toContain('tpl-1');
    expect(bundle.forms.navmc10274.ssicFileNo).toBe('SSIC-10274-MARKER');
    expect(bundle.attachments).toHaveLength(1);
    expect(bundle.attachments[0].id).toBe(fileRef.id);

    // ── Wipe every store + IndexedDB (simulate a brand-new machine) ───────────
    await wipeEverything();
    expect(useProfileStore.getState().profiles).toEqual({});
    expect(useSnippetsStore.getState().snippets).toEqual([]);
    expect(useUserTemplatesStore.getState().templates).toEqual({});
    expect(await loadAttachment(fileRef.id)).toBeNull();
    expect(await idbGetAllDocuments()).toEqual([]);

    // ── Restore, then assert EVERYTHING came back ─────────────────────────────
    const result = await restoreBackup(json);

    // documents
    expect(result.documents.imported).toBe(1);
    expect(useDocumentsStore.getState().docs['doc-1']?.meta.title).toBe('Test Letter');

    // profiles — including the uploaded signature image, byte-for-byte
    expect(result.profilesAdded).toBe(1);
    const restoredProfile = useProfileStore.getState().profiles['Test CO'];
    expect(restoredProfile).toBeDefined();
    expect(restoredProfile.sigLast).toBe('Doe');
    expect(restoredProfile.signatureImage?.data).toBe(SIGNATURE_B64);
    expect(useProfileStore.getState().selectedProfile).toBe('Test CO');

    // snippets
    expect(result.snippetsAdded).toBe(1);
    expect(useSnippetsStore.getState().snippets.find((s) => s.id === 'snip-1')?.text).toContain('In accordance');

    // user templates
    expect(result.templatesAdded).toBe(1);
    expect(useUserTemplatesStore.getState().templates['tpl-1']?.name).toBe('My Template');

    // NAVMC form fields (replaced wholesale on restore — overwrites the WIPED marker)
    expect(result.formsRestored).toBe(true);
    expect(useFormStore.getState().navmc10274.ssicFileNo).toBe('SSIC-10274-MARKER');

    // enclosure attachment bytes
    expect(result.attachmentsAdded).toBe(1);
    const restoredBytes = await loadAttachment(fileRef.id);
    expect(restoredBytes).not.toBeNull();
    expect([...new Uint8Array(restoredBytes!)]).toEqual([...sigBytes]);
  });

  it('restore is non-destructive: newer local profile edits are never clobbered', async () => {
    // Back up a profile, then locally EDIT it, then restore the old backup.
    useProfileStore.setState({ profiles: { 'Test CO': testProfile }, selectedProfile: 'Test CO' });
    useDocumentsStore.setState({ hydrated: true, docs: {}, currentId: null });
    const json = await buildBackup();

    // Local edit after the backup was taken.
    useProfileStore.setState((s) => ({ profiles: { 'Test CO': { ...s.profiles['Test CO'], sigTitle: 'EDITED LOCALLY' } } }));

    const result = await restoreBackup(json);
    expect(result.profilesAdded).toBe(0); // collision → no add
    expect(useProfileStore.getState().profiles['Test CO'].sigTitle).toBe('EDITED LOCALLY'); // local wins
  });

  it('backs up and restores version-history snapshots, incl. an attachment only a snapshot references', async () => {
    await wipeEverything();
    for (const d of (await idbGetAllDocuments()) ?? []) await idbDeleteSnapshots(d.id);

    // An attachment referenced ONLY by an old snapshot (the current doc points at
    // nothing) — this is the blob the GC keeps alive and the backup must carry so
    // the restored history can rehydrate its file.
    const snapBytes = new Uint8Array([9, 8, 7]);
    const snapRef = await persistAttachment({ name: 'v1.pdf', size: 3, type: 'application/pdf' }, snapBytes.buffer);

    useDocumentsStore.setState({
      hydrated: true,
      currentId: 'doc-h',
      docs: {
        'doc-h': {
          meta: { id: 'doc-h', title: 'History Doc', docType: 'naval_letter', updatedAt: 10 },
          session: session({ formData: { subject: 'CURRENT STATE' } }), // no enclosures now
        },
      },
    });
    // Two version-history entries; the older one referenced snapRef's file.
    await idbAddSnapshot('doc-h', { ts: 100, session: session({ formData: { subject: 'EARLIER DRAFT' } }) });
    await idbAddSnapshot('doc-h', {
      ts: 200,
      session: session({ formData: { subject: 'MID DRAFT' }, enclosures: [{ title: 'Draft encl', hasFile: true, fileRef: snapRef }] }),
    });

    // ── Build: bundle carries the ring AND the snapshot-only attachment ──
    const json = await buildBackup();
    const bundle = JSON.parse(json);
    expect(bundle.version).toBe(4);
    expect(bundle.snapshots['doc-h']).toHaveLength(2);
    expect(bundle.attachments.map((a: { id: string }) => a.id)).toContain(snapRef.id);

    // ── Wipe (incl. snapshots) then restore ──
    await wipeEverything();
    await idbDeleteSnapshots('doc-h');
    expect(await idbGetSnapshots('doc-h')).toEqual([]);

    const result = await restoreBackup(json);
    expect(result.snapshotDocs).toBe(1);
    const ring = await idbGetSnapshots('doc-h');
    expect(ring).toHaveLength(2);
    expect(ring.map((s) => s.ts).sort((a, b) => a - b)).toEqual([100, 200]);
    // the snapshot-only enclosure's bytes are back
    expect(await loadAttachment(snapRef.id)).not.toBeNull();
  });

  it('a v3 bundle (no snapshots field) still restores cleanly', async () => {
    await wipeEverything();
    useDocumentsStore.setState({ hydrated: true, currentId: null, docs: {} });
    const v3 = JSON.stringify({
      kind: 'dondocs-backup',
      version: 3,
      documents: [{ id: 'v3-1', meta: { id: 'v3-1', title: 'Legacy v3', docType: 'naval_letter', updatedAt: 5 }, session: session() }],
      profiles: { profiles: {}, selectedProfile: null },
      forms: { navmc10274: null, navmc11811: null },
      snippets: [],
      userTemplates: {},
      attachments: [],
      // no `snapshots` field
    });
    const result = await restoreBackup(v3);
    expect(result.documents.imported).toBe(1);
    expect(result.snapshotDocs).toBe(0);
  });
});
