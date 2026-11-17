import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { parseLetterFile } from '@/lib/importLetter';
import { getSerializedSession, suspendSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbGetAllAttachments, idbGetAllDocuments } from '@/lib/documentsDb';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();

const unsupportedDrawings = [
  ['cropped raster', wordDrawing.replace('<a:stretch>', '<a:srcRect l="25000"/><a:stretch>')],
  ['expanded crop', wordDrawing.replace('<a:stretch>', '<a:srcRect b="-1000"/><a:stretch>')],
  ['malformed crop', wordDrawing.replace('<a:stretch>', '<a:srcRect t="invalid"/><a:stretch>')],
  ['rotation', wordDrawing.replace('<a:xfrm>', '<a:xfrm rot="5400000">')],
  ['horizontal reflection', wordDrawing.replace('<a:xfrm>', '<a:xfrm flipH="1">')],
  ['vertical reflection', wordDrawing.replace('<a:xfrm>', '<a:xfrm flipV="true">')],
  ['masked geometry', wordDrawing.replace('prst="rect"', 'prst="ellipse"')],
  ['image-processing extension', wordDrawing.replace('<a:blip r:embed="image1"/>', '<a:blip r:embed="image1"><a:extLst><a:ext uri="BEBA8EAE-BF5A-486c-A8C5-ECC9F3942E4B"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a14:imgLayer r:embed="image1"><a14:imgEffect><a14:artisticLineDrawing trans="75000" pencilSize="15"/></a14:imgEffect></a14:imgLayer></a14:imgProps></a:ext></a:extLst></a:blip>')],
  ['unknown picture extension', wordDrawing.replace('<a:blip r:embed="image1"/>', '<a:blip r:embed="image1"><a:extLst><a:ext uri="unknown-effect"><other:effect xmlns:other="https://example.invalid/drawing"/></a:ext></a:extLst></a:blip>')],
  ['color effect', wordDrawing.replace('<a:blip r:embed="image1"/>', '<a:blip r:embed="image1"><a:grayscl/></a:blip>')],
] as const;

it.each(unsupportedDrawings)('rejects an actual DOCX with %s rather than exposing its untransformed raster', async (_label, drawing) => {
  const source = await wordImportFixture(`${wordParagraph('Preserved source text.')}<w:p>${drawing}</w:p>`);
  await expect(readWordDocument(source, 'transformed.docx')).rejects.toThrow(/cropped or transformed image/);
});

it('rejects crop through the real file import path before changing the prior draft or writing assets', async () => {
  suspendSessionSaves();
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Existing work remains');
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  const currentId = useDocumentsStore.getState().currentId;
  const before = { session: getSerializedSession(), docs: await idbGetAllDocuments(), assets: await idbGetAllAttachments() };
  const source = await wordImportFixture(`<w:p>${unsupportedDrawings[0][1]}</w:p>`);
  await expect(parseLetterFile(new File([source.buffer as ArrayBuffer], 'cropped.docx'))).rejects.toThrow(/Flatten its visible appearance/);
  await flushDocumentWrites();
  expect(useDocumentsStore.getState().currentId).toBe(currentId);
  expect({ ...getSerializedSession(), timestamp: before.session.timestamp }).toEqual(before.session);
  expect(await idbGetAllDocuments()).toEqual(before.docs);
  expect(await idbGetAllAttachments()).toEqual(before.assets);
});

it('retains ordinary PNG resizing and explicit identity transforms', async () => {
  const drawing = wordDrawing.replace('<a:xfrm>', '<a:xfrm rot="0" flipH="false" flipV="0">').replace('<a:stretch>', '<a:srcRect l="0" t="0" r="0" b="0"/><a:stretch>');
  const imported = await readWordDocument(await wordImportFixture(`<w:p>${drawing}</w:p>`), 'plain.png.docx');
  expect(imported.blocks[0].paragraph.figure).toMatchObject({ name: 'test.png', type: 'image/png', placement: 'body', width: 1, height: 1 });
});

it('retains the known harmless local-DPI extension without accepting arbitrary picture extensions', async () => {
  const drawing = wordDrawing.replace('<a:blip r:embed="image1"/>', '<a:blip r:embed="image1"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst></a:blip>');
  const imported = await readWordDocument(await wordImportFixture(`<w:p>${drawing}</w:p>`), 'local-dpi.docx');
  expect(imported.blocks[0].paragraph.figure).toMatchObject({ type: 'image/png', width: 1, height: 1 });
});

it('retains an untransformed JPEG from a real embedded image relationship', async () => {
  const jpeg = await sharp({ create: { width: 24, height: 12, channels: 3, background: '#eeeeff' } }).jpeg().toBuffer();
  const zip = await JSZip.loadAsync(await wordImportFixture(`<w:p>${wordDrawing}</w:p>`));
  zip.file('word/media/test.jpg', jpeg).remove('word/media/test.png');
  zip.file('word/_rels/document.xml.rels', (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace('media/test.png', 'media/test.jpg'));
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('<Default Extension="png" ContentType="image/png"/>', '<Default Extension="jpg" ContentType="image/jpeg"/>'));
  const imported = await readWordDocument(await zip.generateAsync({ type: 'uint8array' }), 'plain-jpeg.docx');
  expect(imported.blocks[0].paragraph.figure).toMatchObject({ name: 'test.jpg', type: 'image/jpeg', width: 24, height: 12 });
});
