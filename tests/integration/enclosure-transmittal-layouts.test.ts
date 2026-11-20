import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { CUI_TRANSMITTAL_NOTE } from '@/lib/enclosureMarkings';

it.each(['business_letter', 'executive_correspondence'] as const)('prints a confirmed transmittal note on custom %s PDF and Word faces', async docType => {
  const source = buildBaseline(docType);
  source.documentMode = 'custom';
  Object.assign(source.formData, { classLevel: 'cui', cuiTransmittalNote: true, cuiControlledBy: 'Synthetic Office', cuiCategory: 'Privacy' });
  source.enclosures = [{ title: 'Controlled appendix', marking: { classLevel: 'cui' } }];
  source.paragraphs = [{ level: 0, text: 'Synthetic public transmittal body.' }];
  const pdf = await compileFixture(source);
  expect(pdf.ok, formatFailure('custom transmittal', pdf)).toBe(true);
  const text = (await pdfTextLayout(pdf.pdfBytes!)).boxes.filter(box => box.page === 1).map(box => box.text).join(' ');
  expect(text).toContain(CUI_TRANSMITTAL_NOTE);
  const word = await compileDocxFixture(source);
  expect(word.ok, formatDocxFailure('custom transmittal', word)).toBe(true);
  const zip = await JSZip.loadAsync(word.docxBytes!);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect([...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(match => match[1]).join('')).toContain(CUI_TRANSMITTAL_NOTE);
});
