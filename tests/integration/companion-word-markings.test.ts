// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { renderDocx } from '../../companion/renderDocx';
import { renderPdf } from '../../companion/render';
import type { LetterInput } from '../../companion/letterInput';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const cases = [
  { size: 'letter', level: 'secret', marking: 'SECRET' },
  { size: '5x7', level: 'secret', marking: 'SECRET' },
  { size: '7x9', level: 'cui', marking: 'CUI' },
  { size: '5x7', level: 'unclassified', marking: 'SECRET', portion: 'S' },
] as const;

describe.skipIf(!hasPandoc)('companion Word classification banners', () => {
  it.each(cases)('$size $level retains first and continuation banners and valid section order', async test => {
    const input: LetterInput = {
      docType: 'executive_correspondence', subject: 'SYNTHETIC TRAINING DOCUMENT',
      unit: { name: 'TRAINING COMMAND', letterheadMode: 'preprinted', stationerySize: test.size },
      classification: { level: test.level }, signature: { last: 'EXAMPLE' },
      paragraphs: Array.from({ length: 25 }, (_, index) => ({ level: 0,
        text: `Training paragraph ${index + 1}. Synthetic content exercises page furniture and contains no classified information.`,
        ...('portion' in test ? { portionMarking: test.portion } : {}),
      })),
    };
    const zip = await JSZip.loadAsync(await renderDocx(input));
    for (const path of ['word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml']) {
      expect(await zip.file(path)?.async('string'), path).toContain(`<w:t>${test.marking}</w:t>`);
    }
    const xml = await zip.file('word/document.xml')!.async('string');
    const section = xml.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/)![0];
    expect(section).toContain('<w:titlePg');
    expect(section.indexOf('<w:headerReference')).toBeLessThan(section.indexOf('<w:pgSz'));
    expect(section.indexOf('<w:footerReference')).toBeLessThan(section.indexOf('<w:pgSz'));
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    for (const part of ['header1.xml', 'header2.xml', 'footer1.xml', 'footer2.xml']) {
      expect(relationships).toContain(`Target="${part}"`);
      expect(types).toContain(`PartName="/word/${part}"`);
    }
    expect(xml).toContain('Training paragraph 25.');
  });
});

it.each([renderPdf, renderDocx])('rejects unrecognized CUI controls before invoking the companion renderer', async render => {
  const input: LetterInput = {
    docType: 'naval_letter', subject: 'SYNTHETIC TRAINING DOCUMENT',
    classification: { level: 'cui', cui: { category: 'PRVCY', dissemination: 'NOFRN' } },
    paragraphs: [{ text: 'Fictional public training text.' }],
  };
  await expect(render(input)).rejects.toThrow('Review CUI dissemination controls');
});
