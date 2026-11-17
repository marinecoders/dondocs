import { expect, it } from 'vitest';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordDrawing, wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { readWordDocument, wordImageBytes } from '@/services/docx/import/readWord';
import { parseLetterFile } from '@/lib/importLetter';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { validateClassificationMarkings } from '@/lib/classificationValidation';
import { retainedTextClassificationLevel } from '@/lib/detectClassification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { prepareExport, preparedExportMarking } from '@/lib/preparedExport';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { lineToHtml } from '@/components/ui/variable-chip-editor-text';
import { convertRichTextToLatex } from '@/services/latex/escaper';

installWordXmlDom();

it.each(['S', 'TS', 'CUI', 'FOUO'] as const)('preserves visible (%s) offsets and enforces its effective output marking', async mark => {
  const bytes = await wordImportFixture(wordParagraph(`1. (${mark}) Synthetic training paragraph.`));
  const imported = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], 'portion.docx'));
  const session = { ...createBlankSession(), endItems: [], publicationTables: {} };
  session.paragraphs = imported.word!.blocks.map(block => block.paragraph);
  session.formData.classLevel = 'unclassified';
  expect(session.paragraphs[0].text).toBe(`(${mark}) Synthetic training paragraph.`);
  expect(session.paragraphs[0].portionMarking).toBeUndefined();
  const level = mark === 'S' ? 'secret' : mark === 'TS' ? 'top_secret' : 'cui';
  expect(deriveOverallClassLevel('unclassified', session.paragraphs)).toBe(level);
  expect(validateClassificationMarkings('unclassified', session.paragraphs)).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error' })]));
  expect(retainedTextClassificationLevel(imported.word!.source.retainedText)).toBe(level);
  const request = { id: 'source-portion', captured: captureDocumentRevision({ documentId: 'source', epoch: 1, editSequence: 0, capturedAt: 1 }, session), target: 'pdf' as const, filename: 'portion.pdf' };
  const policy = (maxLevel: 'unclassified' | 'top_secret') => resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel, allowedLevels: maxLevel === 'unclassified' ? ['unclassified'] : ['unclassified', 'cui', 'confidential', 'secret', 'top_secret'] }, runtime: { status: 'absent' } });
  expect(prepareExport({ ...request, policy: policy('unclassified') })).toMatchObject({ status: 'error' });
  const allowed = prepareExport({ ...request, policy: policy('top_secret') });
  if (allowed.status !== 'ready') throw new Error(JSON.stringify(allowed));
  expect(preparedExportMarking(allowed.job)?.level).toBe(level);
});

it.each([
  wordRun('1. (S) Synthetic training paragraph.', '<w:b/>'),
  wordRun('(', '<w:b/>') + wordRun('S) Synthetic training paragraph.'),
  wordRun('(') + wordRun('S', '<w:b/>') + wordRun(') Synthetic training paragraph.'),
  wordRun('(', '<w:i/>') + wordRun('S', '<w:u w:val="single"/>') + wordRun(') Synthetic training paragraph.'),
])('uses the visible marking when Word formatting splits inside the portion prefix', async runs => {
  const imported = await readWordDocument(await wordImportFixture(`<w:p>${runs}</w:p>`), 'split-portion.docx');
  const paragraphs = imported.blocks.map(block => block.paragraph);
  expect(deriveOverallClassLevel('unclassified', paragraphs)).toBe('secret');
  expect(validateClassificationMarkings('unclassified', paragraphs)).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error' })]));
  const session = { ...createBlankSession(), endItems: [], publicationTables: {} };session.formData.classLevel = 'unclassified';session.paragraphs = paragraphs;
  const before = structuredClone(paragraphs);
  const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(prepareExport({ id: 'split-portion', captured: captureDocumentRevision({ documentId: 'source', epoch: 1, editSequence: 0, capturedAt: 1 }, session), target: 'pdf', filename: 'portion.pdf', policy: restricted })).toMatchObject({ status: 'error' });
  expect(paragraphs).toEqual(before);
});

it('does not let a lower structured marking override a preserved source prefix in headings or table cells', () => {
  expect(deriveOverallClassLevel('unclassified', [{ portionMarking: 'U', header: '(S) Synthetic heading', text: '' }])).toBe('secret');
  expect(deriveOverallClassLevel('unclassified', [{ bodyTable: { rows: [['*(TS) Synthetic cell*']], headerRows: 0 } }])).toBe('top_secret');
  expect(deriveOverallClassLevel('unclassified', [{ text: 'An ordinary (S) reference in prose.' }])).toBe('unclassified');
});

it('preserves Word nonbreaking hyphens in native paragraphs, tables and retained inventory', async () => {
  const paragraph = '<w:p><w:r><w:t>M</w:t><w:noBreakHyphen/><w:t>16</w:t></w:r></w:p>';
  const result = await readWordDocument(await wordImportFixture(`${paragraph}<w:tbl><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`), 'hyphen.docx');
  expect(result.blocks[0].paragraph.text).toBe('M\u201116');
  expect(result.blocks[1].paragraph.bodyTable?.rows).toEqual([['M\u201116']]);
  expect(result.source.retainedText).toContain('M\u201116');
});

it('coalesces adjacent styled Word runs before native and LaTeX rendering', async () => {
  const source = await wordImportFixture(`<w:p>${wordRun('un', '<w:i/>')}${wordRun('acceptable', '<w:i/>')}</w:p>`);
  const result = await readWordDocument(source, 'italic.docx');
  expect(result.blocks[0].paragraph.text).toBe('*unacceptable*');
  expect(lineToHtml(result.blocks[0].paragraph.text)).toContain('<em>unacceptable</em>');
  expect(convertRichTextToLatex(result.blocks[0].paragraph.text)).toBe('\\textit{unacceptable}');
});

it.each(['ins', 'moveTo'] as const)('keeps proposed %s pictures out of the accepted pre-change baseline', async revision => {
  const result = await readWordDocument(await wordImportFixture(`${wordParagraph('Accepted text.')}<w:p><w:${revision} w:id="1">${wordDrawing}${wordRun('Proposed caption.')}</w:${revision}></w:p>`), 'inserted-picture.docx');
  expect(result.blocks.map(block => block.paragraph.text)).toEqual(['Accepted text.']);
  expect(result.blocks.some(block => block.paragraph.figure)).toBe(false);
  expect(result.source.retainedText).toContain('Proposed caption.');
  expect(result.notices.join(' ')).toContain('Proposed image changes remain in the original');
});

it.each(['del', 'moveFrom'] as const)('keeps original %s pictures in the pre-change baseline with owned bytes', async revision => {
  const result = await readWordDocument(await wordImportFixture(`<w:p><w:${revision} w:id="1">${wordDrawing}</w:${revision}></w:p>`), 'deleted-picture.docx');
  expect(result.blocks).toHaveLength(1);
  expect(result.blocks[0].paragraph.figure?.name).toBe('test.png');
  expect(wordImageBytes(result, result.blocks[0].paragraph.id!)?.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
});
