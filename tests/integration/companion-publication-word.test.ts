/** @vitest-environment node */
import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { renderDocx } from '../../companion/renderDocx';
import { companionPublication } from '../_helpers/companionPublication';

it.each(['MI', 'TI', 'SI', 'LI'] as const)('renders actual %s Word without Pandoc or browser fetch', async type => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  try {
    const input = companionPublication(type);
    const bytes = await renderDocx({ ...input, format: 'docx' });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain(`${type} 12345A-26/1`);
    expect(xml).toContain('SUPPORT BRACKET');
    expect(xml).toContain('END OF INSTRUCTION');
    expect(xml).not.toContain('{{PUBREF_');
    expect(Object.keys(zip.files)).toContain('word/header2-even.xml');
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

it('renders actual TM front matter and SL-3 structured inventory through the shared renderer', async () => {
  const { manualRequest } = await import('../_helpers/manualPacket');
  const { companionSl3 } = await import('../_helpers/companionSl3');
  for (const [input, marker] of [[manualRequest(9), 'TEST-009'], [companionSl3(), 'COMPONENT, Training 003']] as const) {
    const bytes = await renderDocx({ ...input, format: 'docx' });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain(marker);
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('{{PUBREF_');
  }
});

it('retains actual SL-4 raster bytes and rejects companion-only unsupported label preparation', async () => {
  const { readFile } = await import('node:fs/promises');
  const { companionSl3 } = await import('../_helpers/companionSl3');
  const { stockWordSource } = await import('../_helpers/publicationWordQualification');
  const source = stockWordSource('sl4'), input = companionSl3();
  input.docType = 'sl4';
  input.publication = { ...input.publication!, type: 'SL4', sl3: undefined, sl4: source.formData.sl4, shortTitle: source.formData.shortTitle!, nomenclature: source.formData.nomenclature! };
  input.paragraphs = [{ referenceId: source.paragraphs[0].referenceId, text: source.paragraphs[0].text, figure: { fileId: 'artwork', portionMarking: 'U' } }];
  const artwork = new Uint8Array(await readFile('tests/fixtures/publication-word/diagram.png'));
  input.attachments = [{ id: 'artwork', name: 'diagram.png', mimeType: 'image/png', dataBase64: Buffer.from(artwork).toString('base64') }];
  const bytes = await renderDocx({ ...input, format: 'docx' });
  const zip = await JSZip.loadAsync(bytes);
  expect(await zip.file('word/media/image2.png')!.async('uint8array')).toEqual(artwork);
  expect(await zip.file('word/document.xml')!.async('string')).toContain('PART IV');
  input.publication.sl4!.artwork[0].lettering = 'labels';
  input.publication.sl4!.artwork[0].labels = [{ id: 'label-one', text: '1', x: 50, y: 50 }];
  await expect(renderDocx({ ...input, format: 'docx' })).rejects.toThrow('Labelled stock artwork is not supported by companion Word export');
});
