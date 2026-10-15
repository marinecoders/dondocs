import { DISCREPANCY_NOTICE, MI_REPORTING } from '@/data/techpub/sections';
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { publicationDate, validateTimeCompliance, withTimeCompliance } from '@/lib/timeCompliance';
import { validateProcedureSteps } from '@/lib/procedureSteps';
import { iTypeExportErrors } from '@/lib/iTypePreflight';
import { loadFigureFiles, validateFigureAsset, validateFigureFiles } from '@/services/latex/figureAssets';
import { generateAllLatexFiles, generateBodyTex } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import type { Paragraph } from '@/types/document';
import { technicalInstruction, supplyInstruction, lubricationInstruction } from '@/data/templates/technical/i-type-instructions';

const step = (level: number): Paragraph => ({ level, text: 'Inspect the bracket.', procedure: true });
const baseline = () => ({ ...useDocumentStore.getState(), docType: 'i_type', paragraphs: [{ level: 0, header: 'Purpose', text: 'Install the bracket.' }, { level: 0, header: 'Administrative Instructions', text: `For questions or concerns with the content or procedures in this Modification Instruction (MI) contact office@example.mil. ${DISCREPANCY_NOTICE} ${MI_REPORTING}` }],
  formData: { ...useDocumentStore.getState().formData, shortTitle: 'MI 12345A-26/1', pcn: '184 123456 00', nomenclature: 'SUPPORT EQUIPMENT', subject: 'INSTALL THE BRACKET',
    date: '30 Oct 26', publicationSigningDate: '2026-10-15', unitLine1: 'MARINE CORPS SYSTEMS COMMAND', sigLast: 'DOE', controllingOffice: 'Program Office', cuiDistStatement: 'A', signatureType: 'digital' as const,
    fontFamily: 'times', fontSize: '12pt', miUrgency: 'normal' as const, publicationType: 'MI' as const, miCompletionDate: '' },
});

describe('I-Type export checks', () => {
  it('requires a complete distribution statement and a valid date', () => {
    const s = baseline();
    expect(iTypeExportErrors(s)).toEqual([]);
    s.formData.cuiDistStatement = '';
    expect(iTypeExportErrors(s).join(' ')).toMatch(/Distribution Statement/);
    Object.assign(s.formData, { cuiDistStatement: 'D', distDate: 'invalid', distReason: '', controllingOffice: '' });
    expect(iTypeExportErrors(s).join(' ')).toMatch(/reason/);
    expect(iTypeExportErrors(s).join(' ')).toMatch(/determination date/);
  });
  it('rejects unresolved prompts, missing figures, and inherited urgency', () => {
    const s = baseline();
    Object.assign(s.formData, { publicationType: 'TI', miUrgency: 'urgent', miCompletionDate: '2027-03-17' });
    s.paragraphs = [{ text: '[SYSTEM NAME]', level: 0, header: 'Purpose', figure: {} } as Paragraph & { header: string }];
    const errors = iTypeExportErrors(s).join(' ');
    expect(errors).toMatch(/only a Modification Instruction/);
    expect(errors).toMatch(/template prompts/);
    expect(errors).toMatch(/no image/);
  });
  it.each(['2026-10-30', '2027-10-30', '2028-02-29'])('rejects the exact anniversary of %s', (issued) => {
    const start = new Date(`${issued}T12:00:00`);
    const due = issued === '2028-02-29' ? '2029-02-28' : `${Number(issued.slice(0, 4)) + 1}${issued.slice(4)}`;
    expect(validateTimeCompliance('urgent', due, start)).toHaveLength(1);
  });
  it('uses the publication date, rejects impossible dates, and replaces stale paragraph dates', () => {
    expect(validateTimeCompliance('urgent', '2027-10-29', publicationDate('30 Oct 26'))).toEqual([]);
    expect(validateTimeCompliance('urgent', '2027-02-30', publicationDate('30 Oct 26'))).toHaveLength(1);
    const paragraphs = withTimeCompliance([{ level: 0, header: 'Time Compliance Period', text: 'Complete by 2020.' }], 'urgent', '2027-03-17');
    expect(paragraphs[0].text).toBe('Complete this modification by 17 March 2027.');
    const s = baseline(); Object.assign(s.formData, { miUrgency: 'urgent', miCompletionDate: '2027-03-17' });
    expect(generateBodyTex(s)).toContain('17 March 2027');
  });
  it('counts steps within their parents and allows four relative levels', () => {
    expect(validateProcedureSteps([{ level: 0, text: 'First procedure' }, step(1), { level: 0, text: 'Second procedure' }, step(1)]).some((f) => /sibling/.test(f.message))).toBe(true);
    expect(validateProcedureSteps([{ level: 0, text: 'Procedure' }, ...[1, 2, 3, 4, 4, 3, 2, 1].map(step)])).toEqual([]);
  });
  it('normalizes subtype changes and locks the compliant font', () => {
    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState({ ...original, docType: 'naval_letter', documentMode: 'compliant', formData: { ...original.formData, fontFamily: 'courier', miUrgency: 'urgent', miCompletionDate: '2027-03-17' } });
      useDocumentStore.getState().setDocType('i_type');
      useDocumentStore.getState().setFormData({ fontFamily: 'courier', fontSize: '10pt' });
      useDocumentStore.getState().applySnapshot({ ...useDocumentStore.getState().getSnapshot(), formData: { ...useDocumentStore.getState().formData, fontFamily: 'courier' } });
      useDocumentStore.getState().setField('publicationType', 'TI');
      expect(useDocumentStore.getState().formData).toMatchObject({ fontFamily: 'times', fontSize: '12pt', miUrgency: 'normal', miCompletionDate: '' });
    } finally { useDocumentStore.setState(original); }
  });
  it('uses subtype-specific starters', () => {
    for (const template of [technicalInstruction, supplyInstruction, lubricationInstruction]) {
      expect(JSON.stringify(template.paragraphs)).not.toMatch(/modification/i);
    }
  });
  it('rejects reordered fixed paragraphs', () => {
    const s = baseline();
    s.paragraphs.push({ level: 0, header: 'Supply Action', text: 'Order the bracket.' }, { level: 0, header: 'Information', text: 'This instruction covers installation.' });
    expect(iTypeExportErrors(s).join(' ')).toMatch(/prescribed paragraph order/);
  });
  it('includes separately selected graphic classifications in the banner', () => {
    expect(deriveOverallClassLevel('unclassified', [{ portionMarking: 'U', figure: { portionMarking: 'S' } }])).toBe('secret');
  });
});

describe('figure integrity', () => {
  it('rejects unavailable attachments without leaving partially loaded files', async () => {
    const files = {};
    await expect(loadFigureFiles(files, [{ file: 'attachments/figure-1.pdf', ref: { id: 'missing', name: 'drawing.pdf', size: 10, type: 'application/pdf' } }], vi.fn().mockResolvedValue(undefined))).rejects.toThrow(/unavailable/);
    expect(files).toEqual({});
  });
  it('rejects multi-sheet and damaged files', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    await expect(validateFigureAsset(await pdf.save(), 'drawing.pdf')).rejects.toThrow(/2 pages/);
    await expect(validateFigureAsset(new Uint8Array([1, 2]), 'drawing.png')).rejects.toThrow(/Cannot read/);
  });
  it('does not use an asset from a previous compile or document', async () => {
    const s = baseline();
    const ref = { id: 'first', name: 'drawing.pdf', size: 10, type: 'application/pdf' };
    s.paragraphs = [{ level: 0, header: '', text: 'Drawing', figure: { fileRef: ref, type: ref.type } } as Paragraph & { header: string }];
    const a = generateAllLatexFiles(s);
    ref.id = 'second';
    const b = generateAllLatexFiles(s);
    expect(a.figures[0].file).not.toBe(b.figures[0].file);
    await expect(validateFigureFiles({ ...b.texFiles, [a.figures[0].file]: new Uint8Array([1]) })).rejects.toThrow(/missing from this document/);
  });
});

describe('final publication checks', () => {
  it('rejects a midmonth date and missing signing date', () => {
    const s = baseline(); s.formData.date = '15 Oct 26';
    expect(iTypeExportErrors(s).join(' ')).toContain('last working day');
    s.formData.date = '30 Oct 26'; s.formData.publicationSigningDate = '';
    expect(iTypeExportErrors(s).join(' ')).toContain('signing date');
  });
  it('rejects skipped or missing item numbers and unattached tables', () => {
    const s = baseline();
    s.publicationTables = { materielRequired: [{ values: { item: '1', description: 'BRACKET' } }, { values: { item: '3', description: 'BOLT' } }] };
    expect(iTypeExportErrors(s).join(' ')).toContain('exactly one paragraph');
    s.paragraphs.push({ level: 0, header: 'Materiel Required', text: '', tableKey: 'materielRequired' } as typeof s.paragraphs[number]);
    expect(iTypeExportErrors(s).join(' ')).toContain('they read 1, 3');
    s.publicationTables.materielRequired[1].values.item = '';
    expect(iTypeExportErrors(s).join(' ')).toContain('each item needs a number');
  });
});
