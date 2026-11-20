import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { volumeFixture } from '../_helpers/volumeFixture';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';

describe.skipIf(!hasPdfToolchain)('adversarial volume output', () => {
  it('resolves references in headings, contents and bookmark titles', async () => {
    const source = volumeFixture();
    source.formData.volume!.chapters[0].title = 'Continue with {{VOLREF_checks}}';
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('heading references', result)).toBe(true);
    const bytes = await resolvePublicationDestinations(result.pdfBytes!);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    try {
      const reader = await task.promise;
      const outline = await reader.getOutline();
      expect(outline?.map(item => item.title).join(' ')).not.toContain('VOLREF');
      expect(outline?.map(item => item.title).join(' ')).toContain('Continue with 2.1.1');
    } finally { await task.destroy(); }
  });
  it('wraps short identifiers inside a narrow volume table cell', async () => {
    const source = volumeFixture();
    const table = source.paragraphs.find(paragraph => paragraph.bodyTable)!;
    table.bodyTable = { rows: [['ID', 'Detail'], ['012345678901234567', 'Retained adjacent table cell.']], headerRows: 1, columnWidths: [5, 95], fontSize: 10 };
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('narrow volume table', result)).toBe(true);
    const { boxes } = await pdfTextLayout(result.pdfBytes!);
    const identifier = boxes.filter(box => /^[0-9]+$/.test(box.text) && box.left >= 71 && box.left < 95);
    expect(identifier.map(box => box.text).join('')).toContain('012345678901234567');
    expect(identifier.every(box => box.right <= 96)).toBe(true);
  });
  it('refuses an identity link too wide for its table cell instead of overwriting its neighbor', async () => {
    const source = volumeFixture();
    source.paragraphs.find(paragraph => paragraph.bodyTable)!.bodyTable = { rows: [['ID', 'Detail'], ['{{VOLREF_chapter-intro}}', 'Retained adjacent table cell.']], headerRows: 1, columnWidths: [5, 95], fontSize: 10 };
    const result = await compileFixture(source);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ') + result.logTail).toContain('needs a wider column');
  });
  it.each([false, true])('keeps long metadata inside the page without collisions with CUI=%s', async cui => {
    const source = volumeFixture();
    Object.assign(source.formData, { subject: 'VolumeTitle'.repeat(25), shortTitle: 'SHORTTITLE'.repeat(20), controllingOffice: 'ControllingOffice'.repeat(15) });
    if (cui) Object.assign(source.formData, { classLevel: 'cui', cuiControlledBy: 'ControlledBy'.repeat(20), cuiCategory: 'PRVCY', cuiDissemination: 'Dissemination'.repeat(20), pocEmail: 'a'.repeat(60) + '@example.invalid' });
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('long metadata', result)).toBe(true);
    const { boxes, collisions } = await pdfTextLayout(result.pdfBytes!);
    expect(collisions).toEqual([]);
    expect(boxes.filter(box => box.right > 542 || box.left < 70).map(box => ({ text: box.text, left: box.left, right: box.right }))).toEqual([]);
  });
});
