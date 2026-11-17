import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument } from '@/services/docx/import/readWord';
import { assertRetainedTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

installWordXmlDom();
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

it.each(['body', 'alt', 'core-title', 'core-description', 'comment-author'])('checks actual original Word %s metadata against the same retained delivery policy', async kind => {
  const bytes = new Uint8Array(readFileSync(resolve(`tests/fixtures/word/source-metadata-${kind}.docx`)));
  const source = await readWordDocument(bytes, `source-${kind}.docx`);
  expect(source.source.retainedText).toContain('SECRET');
  expect(() => assertRetainedTextPolicy([source.source.retainedText], policy)).toThrow('outside this deployment');
});

it('retains complete original image metadata before native alternative-text shortening', async () => {
  const drawing = wordDrawing.replace('descr="A green test square"', `descr="${'x'.repeat(2_100)}&#10;SECRET"`);
  const source = await readWordDocument(await wordImportFixture(`<w:p>${drawing}</w:p>`), 'long-alt.docx');
  expect(source.blocks[0].paragraph.figure?.altText).toHaveLength(2_000);
  expect(source.blocks[0].paragraph.figure?.altText).not.toContain('SECRET');
  expect(source.source.retainedText).toContain('x'.repeat(2_100) + '\nSECRET');
  expect(() => assertRetainedTextPolicy([source.source.retainedText], policy)).toThrow('outside this deployment');
});

it('joins split Word runs in both pre-change and proposed paragraph views for original handling', async () => {
  const body = `<w:p>${wordRun('SEC')}<w:ins w:id="1" w:author="Reviewer">${wordRun('X')}</w:ins>${wordRun('RET')}</w:p>`;
  const source = await readWordDocument(await wordImportFixture(body), 'split-revision.docx');
  expect(source.source.retainedText.split('\n')).toContain('SECRET');
  expect(source.source.retainedText.split('\n')).toContain('SECXRET');
  expect(() => assertRetainedTextPolicy([source.source.retainedText], policy)).toThrow('outside this deployment');
});

it('inventories a package-owned XML core property selected by content type despite a non-XML extension', async () => {
  const source = await wordImportFixture(wordParagraph('Public synthetic body.'), {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/properties/private.dat" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="properties" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="properties/private.dat"/></Relationships>',
    'properties/private.dat': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>SECRET</dc:description></cp:coreProperties>',
  });
  const imported = await readWordDocument(source, 'typed-property.docx');
  expect(() => assertRetainedTextPolicy([imported.source.retainedText], policy)).toThrow('outside this deployment');
});

it('bounds full source metadata before joining it and accepts a benign complete Word source', async () => {
  const drawing = wordDrawing.replace('descr="A green test square"', `descr="${'x'.repeat(200_001)}"`);
  await expect(readWordDocument(await wordImportFixture(`<w:p>${drawing}</w:p>`), 'too-much-metadata.docx')).rejects.toThrow('retained source-text limit');
  const source = await readWordDocument(await wordImportFixture(wordParagraph('Public synthetic body.')), 'public.docx');
  expect(() => assertRetainedTextPolicy([source.source.retainedText], policy)).not.toThrow();
});
