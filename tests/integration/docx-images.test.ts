import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { prepareDocxImages } from '@/services/docx/imageAssets';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { renderDocx } from '../../companion/renderDocx';
import { toStore } from '../../companion/letterInput';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;

async function verify(bytes: Uint8Array, signature: Uint8Array, figure: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
  expect(media.some(bytes => Buffer.from(bytes).equals(signature))).toBe(true);
  expect(media.some(bytes => Buffer.from(bytes).equals(figure))).toBe(true);
  const xml = await zip.file('word/document.xml')!.async('string');
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  expect(xml).toContain('descr="Handwritten signature image"');
  expect(xml).toContain('descr="Training layout"');
  expect(xml).toContain('Figure 1.');
  expect(xml).toContain('cx="1371600" cy="342900"');
  expect(xml).toContain('cx="5943600" cy="2971800"');
  for (const match of xml.matchAll(/r:embed="([^"]+)"/g)) expect(rels).toContain(`Id="${match[1]}"`);
  expect(rels).not.toMatch(/TargetMode="External"[^>]*Type="[^"\n]*image/);
  expect(xml + rels).not.toContain('blob:');
}

describe.skipIf(!hasPandoc)('embedded Word images', () => {
  it.skipIf(!hasPdfToolchain)('renders a business PDF using a max-length opaque attachment ID', async () => {
    const images = await docxImageFixture();
    const id = '../' + 'f'.repeat(97);
    const store = toStore({ docType: 'business_letter', subject: 'BOUND FIGURE PATH', paragraphs: [{ text: 'Training layout', figure: { fileId: id } }], attachments: [{ id, name: '../../figure.png', mimeType: 'image/png', dataBase64: images.figure.toString('base64') }] });
    const generated = generateAllLatexFiles(store);
    expect(generated.figures[0].file.length).toBeLessThanOrEqual(240);
    const result = await compileGeneratedFixture(generated.texFiles, { [generated.figures[0].file]: images.figure });
    expect(result.ok, result.logTail).toBe(true);
    const imageList = spawnSync('pdfimages', ['-list', `${result.workDir}/main.pdf`], { encoding: 'utf8' });
    expect(imageList.status).toBe(0);
    expect(imageList.stdout).toMatch(/\b480\s+240\b/);
    if (process.env.DONDOCS_IMAGE_ARTIFACTS) {
      await mkdir(process.env.DONDOCS_IMAGE_ARTIFACTS, { recursive: true });
      await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/business-long-id.pdf`, result.pdfBytes!);
    }
  });
  it.each(['png', 'jpeg'] as const)('keeps actual %s images, alternatives and aspect ratios through the browser post-pass', async format => {
    const images = await docxImageFixture();
    const figure = format === 'png' ? images.figure : images.jpeg;
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const store = buildBaseline('business_letter');
    store.documentMode = 'custom';
    store.formData = { ...store.formData, signatureType: 'image', signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } };
    store.paragraphs = [
      { text: 'This fictional business letter contains a diagram and a handwritten signature image.', level: 0 },
      { text: 'Training layout', level: 0, figure: { fileRef: { id: 'fixture', name: `figure.${format}`, size: figure.length, type }, name: `figure.${format}`, type } },
    ];
    const media = await prepareDocxImages(store, async () => figure);
    const compiled = await compileGeneratedDocxFixture(generateFlatLatex(store), store.formData, media);
    expect(compiled.ok, compiled.log).toBe(true);
    const blob = await postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), { docType: store.docType, ...store.formData });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await verify(bytes, images.signature, figure);
    if (process.env.DONDOCS_IMAGE_ARTIFACTS) {
      await mkdir(process.env.DONDOCS_IMAGE_ARTIFACTS, { recursive: true });
      await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/business-images-${format}.docx`, bytes);
      await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/signature.png`, images.signature);
      await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/figure.png`, images.figure);
    }
    if (hasPdfToolchain) {
      const generated = generateAllLatexFiles(store);
      const pdf = await compileGeneratedFixture(generated.texFiles, { 'attachments/signature.png': images.signature, [generated.figures[0].file]: figure });
      expect(pdf.ok, pdf.logTail).toBe(true);
      const imageList = spawnSync('pdfimages', ['-list', `${pdf.workDir}/main.pdf`], { encoding: 'utf8' });
      expect(imageList.status).toBe(0);
      expect(imageList.stdout).toMatch(/\b360\s+90\b/);
      expect(imageList.stdout).toMatch(/\b480\s+240\b/);
      if (process.env.DONDOCS_IMAGE_ARTIFACTS) await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/business-images-${format}.pdf`, pdf.pdfBytes!);
    }
  });

  it('embeds the same bytes through the companion with opaque attachment IDs', async () => {
    const images = await docxImageFixture();
    const diagramId = '../' + 'd'.repeat(97);
    const bytes = await renderDocx({ docType: 'business_letter', subject: 'IMAGE TEST', paragraphs: [{ text: 'Training layout', figure: { fileId: diagramId } }],
      signature: { first: 'Alex', last: 'Example', imageFileId: '../signature' }, attachments: [
        { id: diagramId, name: '../../figure.png', mimeType: 'image/png', dataBase64: images.figure.toString('base64') },
        { id: '../signature', name: '../../signature.png', mimeType: 'image/png', dataBase64: images.signature.toString('base64') },
      ] });
    await verify(bytes, images.signature, images.figure);
    if (process.env.DONDOCS_IMAGE_ARTIFACTS) await writeFile(`${process.env.DONDOCS_IMAGE_ARTIFACTS}/companion-images.docx`, bytes);
  });
});
