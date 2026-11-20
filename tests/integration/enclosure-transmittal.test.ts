import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildBaseline } from '../_helpers/compileMatrix';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { CUI_TRANSMITTAL_NOTE } from '@/lib/enclosureMarkings';

it('prints the confirmed transmittal note on the PDF face and before the Word body', async () => {
  const store = buildBaseline('naval_letter');
  Object.assign(store.formData, { classLevel: 'cui', cuiTransmittalNote: true, cuiControlledBy: 'Synthetic office', cuiCategory: 'Privacy' });
  store.enclosures = [{ title: 'Synthetic controlled appendix', marking: { classLevel: 'cui' } }];
  store.paragraphs = Array.from({ length: 20 }, (_, index) => ({ level: 0,
    text: `SYNTHETIC BODY ${index + 1}. ${'Public training text for a long transmittal letter. '.repeat(10)}` }));
  const pdf = await compileFixture(store);
  if (!pdf.ok) throw new Error(formatFailure('CUI transmittal', pdf));
  const { boxes } = await pdfTextLayout(pdf.pdfBytes!);
  expect(boxes.filter(box => box.page === 1).map(box => box.text).join(' ')).toContain('When enclosures are removed');
  expect(boxes.filter(box => box.page > 1).map(box => box.text).join(' ')).not.toContain('When enclosures are removed');
  const word = await compileDocxFixture(store);
  if (!word.ok) throw new Error(formatDocxFailure('CUI transmittal', word));
  const zip = await JSZip.loadAsync(word.docxBytes!);
  const xml = await zip.file('word/document.xml')!.async('string');
  const text = [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(match => match[1]).join('');
  expect(text).toContain(CUI_TRANSMITTAL_NOTE);
  expect(text.indexOf(CUI_TRANSMITTAL_NOTE)).toBeLessThan(text.indexOf('SYNTHETIC BODY 1.'));
}, 60_000);

it('omits the cover-only note from real PDF and Word output containing a controlled endorsement', async () => {
  const store = buildBaseline('naval_letter');
  Object.assign(store.formData, { classLevel: 'cui', cuiTransmittalNote: true, cuiControlledBy: 'Synthetic office', cuiCategory: 'Privacy',
    appendEndorsement: true, endorsementFrom: 'Synthetic reviewer', endorsementTo: 'Synthetic sender',
    endorsementBody: '(CUI) CONTROLLED ACKNOWLEDGEMENT', endorsementSigLast: 'EXAMPLE' });
  store.enclosures = [{ title: 'Synthetic controlled appendix', marking: { classLevel: 'cui' } }];
  const pdf = await compileFixture(store);
  if (!pdf.ok) throw new Error(formatFailure('Controlled endorsement transmittal', pdf));
  const { boxes } = await pdfTextLayout(pdf.pdfBytes!);
  const printed = boxes.map(box => box.text).join(' ');
  expect(printed).toContain('CONTROLLED ACKNOWLEDGEMENT');
  expect(printed).not.toContain('When enclosures are removed');
  const word = await compileDocxFixture(store);
  if (!word.ok) throw new Error(formatDocxFailure('Controlled endorsement transmittal', word));
  const zip = await JSZip.loadAsync(word.docxBytes!);
  const xml = await zip.file('word/document.xml')!.async('string');
  const text = [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map(match => match[1]).join('');
  expect(text).toContain('CONTROLLED ACKNOWLEDGEMENT');
  expect(text).not.toContain(CUI_TRANSMITTAL_NOTE);
}, 60_000);
