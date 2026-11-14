import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import type { ActionPackage } from '@/lib/actionPackages';
import { persistAttachment } from '@/lib/attachments';
import { portableResourceDigest } from '@/lib/portableResources';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { acknowledgeWordPackage, prepareWordPackage, renderWordPackage } from '@/services/exports/wordPackage';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
it.skipIf(!hasPandoc)('delivers real editable DOCX paragraphs, fields, images and links with unchanged original enclosure digests', async () => {
  const images = await docxImageFixture(), pdf = await PDFDocument.create();pdf.addPage().drawText('Separate original supporting PDF');
  const original = new Uint8Array(await pdf.save()).buffer;
  const figureRef = await persistAttachment({ name: 'figure.png', type: 'image/png', size: images.figure.length }, new Uint8Array(images.figure).buffer);
  const main = await capturePackageMember(captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 3, capturedAt: Date.UTC(2026, 10, 14) }, {
    documentMode: 'custom', documentCategory: 'correspondence', docType: 'business_letter',
    formData: { subject: 'WORD PACKAGE CONTENT', to: 'Training Office', date: 'November 14, 2026', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image', pageNumbering: 'simple',
      signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } },
    paragraphs: [{ text: 'This captured paragraph cites Reference (a) and Enclosure (1).', level: 0 }, { text: 'Nested editable content.', level: 1 }, { text: 'Training diagram', level: 0, figure: { name: 'figure.png', type: 'image/png', fileRef: figureRef } }],
    references: [{ letter: 'a', title: 'Training guidance', url: 'https://example.test/guidance' }],
    enclosures: [{ title: 'Training annex', file: { name: 'Annexe résumé.pdf', size: original.byteLength, data: original } }], copyTos: [], distributions: [], endItems: [], publicationTables: {},
    reviewComments: { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Private reviewer', text: 'Hidden review metadata', createdAt: '2026-11-14T00:00:00Z' }] }] },
  }), 'Lettre résumé', 'basic-letter');
  const signed = await captureOriginalPackageMember({ name: 'Annexe résumé.pdf', data: original }, 'enclosure', true);
  const record: ActionPackage = { kind: 'dondocs-action-package-record', version: 1, id: 'package_native', name: 'Word package fixture', archived: false, sequence: 1, currentRevisionId: 'revision_native',
    revisions: [{ id: 'revision_native', createdAt: Date.UTC(2026, 10, 14), members: [main, signed], outputs: [] }] };
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const prepared = await prepareWordPackage(record, record.currentRevisionId, policy);acknowledgeWordPackage(prepared);
  const result = await renderWordPackage(prepared, {
    compile: async () => { throw new Error('Unexpected PDF compile'); },
    convertDocx: async (latex, options) => {
      const compiled = await compileGeneratedDocxFixture(latex, options, options.mediaFiles);
      expect(compiled.ok, compiled.log).toBe(true);
      return postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), options);
    },
  });
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer(), { checkCRC32: true });
  const word = await JSZip.loadAsync(await zip.file(result.manifest.mainDocument)!.async('uint8array'));
  const xml = await word.file('word/document.xml')!.async('string'), rels = await word.file('word/_rels/document.xml.rels')!.async('string');
  expect(xml).toContain('WORD PACKAGE CONTENT');expect(xml).toContain('Nested editable content.');
  expect(xml).toContain('This captured paragraph cites');expect(xml).toContain('Enclosure (1)');expect(xml).toContain('Reference (a)');
  expect(xml).toContain('descr="Training diagram"');expect(xml).toContain('descr="Handwritten signature image"');
  const footers = (await Promise.all(Object.values(word.files).filter(file => /^word\/footer.*\.xml$/.test(file.name)).map(file => file.async('string')))).join('');
  expect(footers).toContain('PAGE');expect(rels).toContain('https://example.test/guidance');
  expect(xml).not.toContain('Hidden review metadata');expect(xml).not.toContain('Private reviewer');expect(await word.file('word/comments.xml')?.async('string') || '').not.toMatch(/<w:comment\b/);
  const media = await Promise.all(Object.values(word.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
  expect(media.some(bytes => Buffer.from(bytes).equals(images.signature))).toBe(true);
  expect(media.some(bytes => Buffer.from(bytes).equals(images.figure))).toBe(true);
  const pdfs = result.manifest.files.filter(file => file.kind === 'original' && file.name.endsWith('.pdf'));
  expect(pdfs).toHaveLength(2);
  for (const file of pdfs) {
    const bytes = await zip.file(file.path)!.async('uint8array');
    expect(Buffer.from(bytes)).toEqual(Buffer.from(original));expect(file.sha256).toBe(await portableResourceDigest(original));
  }
  if (process.env.DONDOCS_WORD_PACKAGE_ARTIFACTS) {
    await mkdir(process.env.DONDOCS_WORD_PACKAGE_ARTIFACTS, { recursive: true });
    await writeFile(`${process.env.DONDOCS_WORD_PACKAGE_ARTIFACTS}/word-package.zip`, new Uint8Array(await result.blob.arrayBuffer()));
    await writeFile(`${process.env.DONDOCS_WORD_PACKAGE_ARTIFACTS}/main.docx`, await zip.file(result.manifest.mainDocument)!.async('uint8array'));
  }
}, 45_000);
