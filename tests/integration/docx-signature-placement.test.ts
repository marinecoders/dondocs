import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { prepareDocxImages } from '@/services/docx/imageAssets';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { renderDocx } from '../../companion/renderDocx';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline, type DocType } from '../_helpers/compileMatrix';
import { docxImageFixture } from '../_helpers/docxImageFixture';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const cases = ['joint_letter', 'joint_memorandum', 'moa', 'mou'].flatMap(docType =>
  (['junior', 'senior'] as const).map(signer => ({ docType: docType as DocType, signer })));

async function verify(bytes: Uint8Array, signer?: 'junior' | 'senior') {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')!.async('string');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const images = [...document.getElementsByTagName('wp:docPr')].filter(node => node.getAttribute('descr') === 'Handwritten signature image');
  expect(images).toHaveLength(1);
  expect(xml).toContain('cx="1371600" cy="342900"');
  let cell = images[0].parentElement;
  while (cell && cell.tagName !== 'w:tc') cell = cell.parentElement;
  expect(cell).toBeTruthy();
  expect(cell!.parentElement!.getElementsByTagName('w:trHeight')).toHaveLength(0);
  if (signer) {
    const cells = [...cell!.parentElement!.children].filter(node => node.tagName === 'w:tc');
    expect(cells.indexOf(cell!)).toBe(signer === 'junior' ? 0 : 1);
  } else {
    expect(cell!.textContent).toContain('Training Sender');
    expect(cell!.parentElement!.textContent).toContain('FROM:');
  }
  return zip;
}

describe.skipIf(!hasPandoc)('selected Word signature images', () => {
  it.each(cases)('places exactly one image in the $signer cell of $docType', async ({ docType, signer }) => {
    const { signature } = await docxImageFixture();
    const store = buildBaseline(docType);
    store.formData = { ...store.formData, signatureType: 'image', signatureImageSigner: signer,
      signatureImage: { name: 'signature.png', size: signature.length, data: signature.toString('base64') } };
    const media = await prepareDocxImages(store, async () => { throw new Error('Unexpected resource read'); });
    const compiled = await compileGeneratedDocxFixture(generateFlatLatex(store), store.formData, media);
    expect(compiled.ok, compiled.log).toBe(true);
    const output = await postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), { docType, ...store.formData });
    const bytes = new Uint8Array(await output.arrayBuffer());
    const zip = await verify(bytes, signer);
    const images = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('nodebuffer')));
    expect(images.filter(image => image.equals(signature))).toHaveLength(1);
    if (process.env.DONDOCS_WORD_ARTIFACTS) {
      await mkdir(process.env.DONDOCS_WORD_ARTIFACTS, { recursive: true });
      await writeFile(`${process.env.DONDOCS_WORD_ARTIFACTS}/${docType}-${signer}.docx`, bytes);
    }
  });

  it('puts the information-memorandum image with its FROM sender', async () => {
    const { signature } = await docxImageFixture();
    const store = buildBaseline('information_memorandum');
    store.formData = { ...store.formData, from: 'Training Sender', signatureType: 'image',
      signatureImage: { name: 'signature.png', size: signature.length, data: signature.toString('base64') } };
    const media = await prepareDocxImages(store, async () => new Uint8Array());
    const compiled = await compileGeneratedDocxFixture(generateFlatLatex(store), store.formData, media);
    expect(compiled.ok, compiled.log).toBe(true);
    const output = await postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), { docType: store.docType, ...store.formData });
    const bytes = new Uint8Array(await output.arrayBuffer());
    await verify(bytes);
    if (process.env.DONDOCS_WORD_ARTIFACTS) await writeFile(`${process.env.DONDOCS_WORD_ARTIFACTS}/information-memo.docx`, bytes);
  });

  it('uses the same explicit party through companion output', async () => {
    const { signature } = await docxImageFixture();
    for (const signer of ['junior', 'senior'] as const) {
      const bytes = await renderDocx({ docType: 'joint_letter', subject: 'SYNTHETIC SIGNATURE',
        signature: { imageFileId: 'sig', imageSigner: signer },
        attachments: [{ id: 'sig', name: 'sig.png', mimeType: 'image/png', dataBase64: signature.toString('base64') }] });
      await verify(bytes, signer);
    }
  });
});
