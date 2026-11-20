import 'fake-indexeddb/auto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { persistAttachment } from '@/lib/attachments';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { buildAssetSharePayload, isAssetShare, parseSharedDocument } from '@/lib/assetShare';
import { openSharedDocument } from '@/lib/sharedDocumentActions';
import { openSessionAsNew } from '@/stores/documentsStore';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { useProfileStore } from '@/stores/profileStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useUIStore } from '@/stores/uiStore';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { volumeFixture } from './_helpers/volumeFixture';

function fixture(kind: 'active' | 'retained' | 'section-only'): SerializedSession {
  const source = volumeFixture();
  if (kind === 'section-only') return { documentMode: 'custom', documentCategory: 'correspondence', formType: 'navmc_10274', docType: 'naval_letter', formData: { subject: 'Retained section binding' }, paragraphs: [{ id: 'bound', text: 'Keep my section identity.', level: 0, volumeSectionId: 'retained-section' }], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1 };
  const docType = kind === 'active' ? 'technical_volume' : 'naval_letter';
  return { ...source, formData: { ...source.formData, docType }, documentMode: 'compliant', documentCategory: 'correspondence', formType: 'navmc_10274', docType, timestamp: 1 };
}
function snapshot(session: SerializedSession): DocumentSnapshot {
  return { ...session, endItems: session.endItems ?? [], publicationTables: session.publicationTables ?? {} };
}
async function retainProbeFixture(name: string, value: unknown): Promise<void> {
  // An opt-in audit emits the exact production serializer output for a separate
  // immutable old-release process. Normal test runs write no external files.
  const directory = process.env.DONDOCS_FORMAT_FIXTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), JSON.stringify(value));
}
beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useSnippetsStore.setState({ snippets: [] });
  useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: 'ok' });
});

describe('volume transport reader requirements', () => {
  it.each(['active', 'retained', 'section-only'] as const)('requires a current draft/share reader for %s volume data', async kind => {
    const source = fixture(kind);
    const shared = createSharedPayload(source);
    const draft = await buildDraftFileFromSnapshot(snapshot(source), 123);
    expect(shared.version).toBe(7);
    expect(draft).toMatchObject({ kind: 'dondocs-draft', version: 5 });
    expect(isAssetShare(shared)).toBe(false);
    const received = (await parseSharedDocument(JSON.parse(JSON.stringify(shared)))).session;
    const opened = parseDraftFile(JSON.parse(JSON.stringify(draft))).session;
    expect(received.formData.volume).toEqual(source.formData.volume);
    expect(received.paragraphs.map(paragraph => paragraph.volumeSectionId)).toEqual(source.paragraphs.map(paragraph => paragraph.volumeSectionId));
    const outcome = openSessionAsNew(parseSharedSession(shared));
    expect(outcome).toBe('applied');
    expect(useDocumentStore.getState().formData.volume).toEqual(source.formData.volume);
    expect(useDocumentStore.getState().paragraphs.map(paragraph => paragraph.volumeSectionId)).toEqual(source.paragraphs.map(paragraph => paragraph.volumeSectionId));
    expect(opened.formData.volume).toEqual(source.formData.volume);
    expect(opened.paragraphs.map(paragraph => paragraph.volumeSectionId)).toEqual(source.paragraphs.map(paragraph => paragraph.volumeSectionId));
    await retainProbeFixture(`${kind}-share.json`, shared);
    await retainProbeFixture(`${kind}-draft.json`, draft);
  });
  it.each(['active', 'retained', 'section-only'] as const)('exports a current workspace format and restores %s volume data intact', async kind => {
    const source = fixture(kind);
    const id = `volume-${kind}`;
    useDocumentsStore.setState({ docs: { [id]: { meta: { id, title: 'Synthetic volume', docType: source.docType, updatedAt: 1 }, session: source } } });
    const json = await buildBackup();
    const bundle = JSON.parse(json);
    expect(bundle.version).toBe(16);
    await retainProbeFixture(`${kind}-workspace.json`, bundle);
    useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
    await restoreBackup(json);
    const restored = useDocumentsStore.getState().docs[id].session;
    expect(restored.formData.volume).toEqual(source.formData.volume);
    expect(restored.paragraphs.map(paragraph => paragraph.volumeSectionId)).toEqual(source.paragraphs.map(paragraph => paragraph.volumeSectionId));
  });
});


for (const feature of ['volume', 'marking', 'table'] as const) {
  for (const assets of [false, true]) {
    it(`opens ${feature} ${assets ? 'asset' : 'plain'} shares through the public import route`, async () => {
      const source = snapshot(feature === 'volume' ? fixture('active') : fixture('section-only'));
      if (feature !== 'volume') source.paragraphs = [{ id: 'text', text: 'Synthetic shared source.', level: 0 }];
      if (feature === 'marking') source.enclosures = [{ title: 'Explicit marking', marking: { classLevel: 'unclassified' } }];
      if (feature === 'table') source.paragraphs[0].bodyTable = { rows: [['One', 'Two'], ['A', 'B']], headerRows: 1, columnWidths: [40, 60], columnAlignments: ['left', 'right'], borders: 'outline', fontSize: 11, minimumRowHeight: 18, repeatHeaders: false };
      let image: Uint8Array | undefined;
      if (assets && feature === 'marking') {
        const pdf = await PDFDocument.create(); pdf.addPage();
        const bytes = await pdf.save();
        source.enclosures[0].file = { name: 'synthetic.pdf', size: bytes.byteLength, data: new Uint8Array(bytes).buffer };
      } else if (assets) {
        image = new Uint8Array(await sharp({ create: { width: 24, height: 16, channels: 4, background: '#abcdef' } }).png().toBuffer());
        const fileRef = await persistAttachment({ name: 'synthetic.png', type: 'image/png', size: image.byteLength }, new Uint8Array(image).buffer);
        source.paragraphs.push({ id: 'graphic', text: 'Synthetic figure', level: 0, ...(feature === 'volume' ? { volumeSectionId: 'section-intro' } : {}), figure: { fileRef, name: 'synthetic.png', type: 'image/png', placement: 'body', altText: 'Synthetic rectangle' } });
      }
      const payload = await buildAssetSharePayload(source, 123) as { version: number };
      expect(payload.version).toBe(assets ? feature === 'marking' ? 4 : 6 : 7);
      expect(isAssetShare(payload)).toBe(assets);
      const reviewed = await parseSharedDocument(payload);
      expect(reviewed.session.formData.volume).toEqual(source.formData.volume);
      expect(reviewed.session.enclosures[0]?.marking).toEqual(source.enclosures[0]?.marking);
      expect(reviewed.session.paragraphs[0].bodyTable).toEqual(source.paragraphs[0].bodyTable);
      if (image) expect(new Uint8Array(reviewed.figures.at(-1)!.data)).toEqual(image);
      const outcome = assets ? await openSharedDocument(payload) : openSessionAsNew(parseSharedSession(payload));
      expect(outcome).toBe('applied');
      const opened = useDocumentStore.getState();
      expect(opened.formData.volume).toEqual(source.formData.volume);
      expect(opened.enclosures[0]?.marking).toEqual(source.enclosures[0]?.marking);
      expect(opened.paragraphs[0].bodyTable).toEqual(source.paragraphs[0].bodyTable);
      await retainProbeFixture(`feature-${feature}-${assets ? 'asset' : 'plain'}-share.json`, payload);
    });
  }
}
