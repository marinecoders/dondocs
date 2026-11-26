import { describe, expect, it } from 'vitest';
import { getPreviewHints, previewCopyTo, previewExamples, STARTER_EXAMPLE_SECTIONS, type StarterExampleSection } from '@/lib/previewHints';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { escapeLatex } from '@/services/latex/escaper';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import type { DocumentData, Paragraph } from '@/types/document';

const draft = (docType: string, formData: Partial<DocumentData> = {}, paragraphs: Paragraph[] = []) => ({
  docType, documentMode: 'compliant' as const, formData, paragraphs,
  references: [], enclosures: [], copyTos: [], distributions: [],
});
const preview = (source: Parameters<typeof generateAllLatexFiles>[0], hiddenStarterSections?: readonly StarterExampleSection[]) =>
  generateAllLatexFiles(source, undefined, undefined, undefined, { previewHints: true, hiddenStarterSections });

describe('live preview hints', () => {
  it('starts with blank values and retains per-field edits without filling other fields', () => {
    const source = createBlankSession(undefined, 'naval_letter');
    expect(source.formData).toMatchObject({ to: '', from: '', subject: '', unitLine1: '', sigLast: '', date: '', officeCode: '', ssic: '' });
    expect(source.paragraphs).toMatchObject([{ text: '' }]);
    expect(source.copyTos).toEqual([]);
    const before = Object.values(preview(source).texFiles).join('\n');
    expect(before).toContain('[RECIPIENT]');
    expect(before).toContain('Commanding Officer, Marine Innovation Unit');
    const after = preview({ ...source, documentMode: 'compliant', formData: { ...source.formData, to: 'Training Officer' } }).texFiles;
    expect(after['document.tex']).toContain('Training Officer');
    expect(after['document.tex']).not.toContain('[RECIPIENT]');
    expect(after['document.tex']).toContain('[SUBJECT]');
    expect(after['signatory.tex']).toMatch(/\\setSignatoryAbbrev\{.*\/sigfirst\}\{J\.\} .*\/sigmiddle\}\{A\.\} .*\/siglast\}\{DOE\}/);
    expect(Object.values(generateAllLatexFiles(source).texFiles).join('\n')).not.toMatch(/Marine Innovation Unit|J\. A\. DOE|\[RECIPIENT\]/);
  });

  it('keeps an unfilled date blank on a format switch', () => {
    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState(createBlankSession());
      useDocumentStore.getState().setDocType('business_letter');
      expect(useDocumentStore.getState().formData.date).toBe('');
    } finally {
      useDocumentStore.setState(original);
    }
  });

  it('marks required values locally with no changes to the draft or clean export source', () => {
    const source = draft('naval_letter', { subject: '   ', sigFirst: 'Alex', sigMiddle: 'D.' }, [{ id: 'first', level: 0, text: '' }]);
    const original = structuredClone(source);
    const { texFiles, hasPreviewHints } = preview(source);
    expect(hasPreviewHints).toBe(true);
    expect(texFiles['document.tex']).toContain('\\PreviewHintLink{https://dondocs.invalid/preview-hint/subject}{[SUBJECT]}');
    expect(texFiles['letterhead.tex']).toContain(previewExamples.unit);
    expect(texFiles['signatory.tex']).toContain('A. D. \\PreviewHintLink');
    expect(texFiles['body.tex']).toContain(escapeLatex(previewExamples.body));
    expect(source).toEqual(original);
    expect(Object.values(generateAllLatexFiles(source).texFiles).join('\n')).not.toMatch(/PreviewHint|dondocs\.invalid/);
    expect(generateFlatLatex(source)).not.toMatch(/PreviewHint|dondocs\.invalid|\[SUBJECT\]/);
  });

  it('uses actual values once every original starter field is filled', () => {
    const source = { ...draft('naval_letter', {
      subject: 'Real edits', from: 'Sending Command', to: 'Training Office', unitLine1: 'Example Battalion',
      unitLine2: 'Example Command', unitAddress: '20 Main Street, Quantico, VA 22134',
      sigFirst: 'Alex', sigMiddle: 'B', sigLast: 'Smith', officeCode: 'ADMIN', serial: '111', ssic: '5216', date: '23 Nov 26',
    }, [{ level: 0, text: 'Real paragraph' }]), copyTos: previewCopyTo.map((_, index) => ({ text: `Recipient ${index + 1}` })) };
    const { texFiles, hasPreviewHints } = preview(source);
    expect(hasPreviewHints).toBe(false);
    expect(texFiles).toEqual(generateAllLatexFiles(source).texFiles);
    expect(texFiles['document.tex']).toContain('REAL EDITS');
    expect(texFiles['document.tex']).not.toContain('\\setViaRows');
  });

  it('keeps the actual copy-to list together and replaces individual sender and signer values', () => {
    const source = { ...draft('naval_letter', { to: '[Group 3]', serial: '044', sigLast: 'Smith' }), copyTos: [{ text: 'Training' }] };
    const { texFiles } = preview(source);
    expect(texFiles['document.tex']).toContain('[Group 3]');
    expect(texFiles['document.tex']).not.toContain('[RECIPIENT]');
    expect(texFiles['document.tex']).toMatch(/\\setSerial\{Ser .*\/officecode\}\{S-3\}\\PreviewHint\{\/\}044\}/);
    expect(texFiles['signatory.tex']).toMatch(/\\setSignatoryAbbrev\{.*\/sigfirst\}\{J\.\} .*\/sigmiddle\}\{A\.\} SMITH\}/);
    expect(texFiles['copyto-config.tex']).toContain('Training');
    expect(texFiles['copyto-config.tex']).not.toMatch(/G-3\/5|G-4|Regimental S-3|PreviewHint/);
    expect(generateAllLatexFiles(source).texFiles['copyto-config.tex']).not.toMatch(/G-4|Regimental S-3|PreviewHint/);
    expect(getPreviewHints(draft('naval_letter', { serial: 'Ser ADMIN/044' })).officeCode).toBeUndefined();
  });

  it('hides examples independently and keeps required hints in edited categories', () => {
    const source = { ...draft('naval_letter', { to: 'Training Office' }), copyTos: [{ text: ' ' }] };
    const letterheadEdited = getPreviewHints(source, undefined, ['letterhead', 'addressing']);
    expect(letterheadEdited.unitLine1).toBeDefined();
    expect(letterheadEdited.unitLine2).toBeUndefined();
    expect(letterheadEdited.unitAddress).toBeUndefined();
    expect(letterheadEdited.serial).toBeDefined();
    expect(letterheadEdited.copyToFirst).toBeDefined();
    const senderEdited = getPreviewHints(source, undefined, ['senderSymbols']);
    expect(senderEdited.ssic).toBeDefined();
    expect(senderEdited.date).toBeDefined();
    expect(senderEdited.serial).toBeUndefined();
    expect(senderEdited.unitAddress).toBeDefined();
    expect(senderEdited.copyToFirst).toBeDefined();
    const hints = getPreviewHints(source, undefined, STARTER_EXAMPLE_SECTIONS);
    expect(Object.keys(hints).sort()).toEqual(['body', 'date', 'from', 'sigLast', 'ssic', 'subject', 'unitLine1']);
    expect(preview(source, ['copyTo']).texFiles['copyto-config.tex']).toBe('% No copy-to recipients\n');
    const mfr = getPreviewHints(draft('mfr'), undefined, STARTER_EXAMPLE_SECTIONS);
    expect(mfr.unitLine1).toBeUndefined();
    expect(mfr.ssic).toBeUndefined();
    const business = getPreviewHints(draft('business_letter'), undefined, STARTER_EXAMPLE_SECTIONS);
    expect(business.subject).toBeUndefined();
    expect(business.salutation?.text).toBe(previewExamples.salutation);
    expect(business.complimentaryClose?.text).toBe(previewExamples.close);
    const customBusiness = getPreviewHints({ ...draft('business_letter'), documentMode: 'custom' }, undefined, STARTER_EXAMPLE_SECTIONS);
    expect(customBusiness.subject).toBeUndefined();
    expect(customBusiness.salutation).toBeUndefined();
    expect(customBusiness.complimentaryClose).toBeUndefined();
  });

  it('keeps only the signer name and the required authentication title after editing a manual signature', () => {
    const hints = getPreviewHints(draft('tm_ietm_front_matter', { sigMiddle: 'R' }), undefined, ['signature']);
    expect(hints.sigLast).toBeDefined();
    expect(hints.sigTitle).toBeDefined();
    expect(hints.sigFirst).toBeUndefined();
    expect(hints.sigMiddle).toBeUndefined();
    expect(hints.sigRank).toBeUndefined();
  });

  it('treats the basic-letter ID as optional for same-page endorsements only', () => {
    expect(getPreviewHints(draft('same_page_endorsement')).basicLetterId).toBeDefined();
    expect(getPreviewHints(draft('same_page_endorsement'), undefined, ['basic']).basicLetterId).toBeUndefined();
    expect(getPreviewHints(draft('same_page_endorsement', { includeEndorsementSubject: true }), undefined, ['basic']).basicLetterId).toBeDefined();
    expect(getPreviewHints(draft('new_page_endorsement'), undefined, ['basic']).basicLetterId).toBeDefined();
  });

  it('honors optional or preprinted letterhead and alternate addressing layouts', () => {
    expect(getPreviewHints(draft('naval_letter', { letterheadMode: 'preprinted' })).unitLine1).toBeUndefined();
    const title = getPreviewHints(draft('naval_letter', { letterheadMode: 'title-only' }));
    expect(title).toHaveProperty('unitLine1');
    expect(title).not.toHaveProperty('unitLine2');
    expect(title).not.toHaveProperty('unitAddress');
    const mfr = getPreviewHints(draft('mfr'));
    expect(mfr).toHaveProperty('unitLine1');
    expect(mfr).toHaveProperty('date');
    expect(mfr).not.toHaveProperty('ssic');
    expect(mfr).not.toHaveProperty('from');
    expect(mfr).not.toHaveProperty('to');
    const business = getPreviewHints(draft('business_letter'));
    expect(business.subject?.text).toBe(previewExamples.subject);
    expect(business.to?.text).toBe(previewExamples.to);
    expect(business.salutation?.text).toBe(previewExamples.salutation);
    expect(getPreviewHints({ ...draft('business_letter'), documentMode: 'custom' }).salutation?.text).toBe(previewExamples.salutation);
    expect(getPreviewHints(draft('action_memorandum')).subject?.text).toBe(previewExamples.subject);
    expect(getPreviewHints(draft('information_memorandum')).sigLast).toBeUndefined();
    expect(getPreviewHints(draft('same_page_endorsement')).subject).toBeUndefined();
    expect(getPreviewHints(draft('same_page_endorsement', { includeEndorsementSubject: true })).subject).toBeDefined();
  });

  it('omits the recipient hint when a multiple address letter uses Distribution', () => {
    const source = draft('multiple_address_letter');
    const blank = { ...source, distributions: [{ text: ' ' }] };
    expect(getPreviewHints(blank).to).toBeDefined();
    expect(preview(blank).texFiles['distribution-config.tex']).toBe('% No distribution recipients\n');
    const distributed = { ...source, distributions: [{ text: 'Training Command' }] };
    expect(getPreviewHints(distributed).to).toBeUndefined();
    const { texFiles } = preview(distributed);
    expect(texFiles['document.tex']).not.toContain('[RECIPIENT]');
    expect(texFiles['distribution-config.tex']).toContain('Training Command');
  });

  it('omits the body example after the author enters content in a body table', () => {
    const source = draft('naval_letter', {}, [{ level: 0, text: '', bodyTable: { headerRows: 1, rows: [[''], ['']] } }]);
    expect(getPreviewHints(source).body).toBeDefined();
    source.paragraphs[0].bodyTable!.rows[0][0] = 'Training status';
    expect(getPreviewHints(source).body).toBeUndefined();
  });

  it('keeps the preview hint after an empty table when the corresponding paragraph follows the table', () => {
    const source = draft('naval_letter', {}, [
      { level: 0, text: '', bodyTable: { headerRows: 1, rows: [[''], ['']] } },
      { level: 0, id: 'after-table', text: '' },
    ]);
    const body = preview(source).texFiles['body.tex'];
    const table = body.indexOf('longtable');
    expect(table).toBeGreaterThan(-1);
    expect(body.indexOf('Your content here')).toBeGreaterThan(table);
    expect(getPreviewHints(source).body?.paragraphId).toBe('after-table');
  });

  it('keeps the body hint for an inactive figure retained from another format', () => {
    const figure = { fileRef: { id: 'image', name: 'training.png', type: 'image/png', size: 1 } };
    const source = draft('standard_letter', {}, [{ level: 0, text: '', figure }]);
    expect(getPreviewHints(source).body).toBeDefined();
    expect(getPreviewHints({ ...source, docType: 'business_letter' }).body).toBeUndefined();
  });

  it('preserves real headings and only inserts one hint into an unwritten body', () => {
    const source = draft('naval_letter', {}, [
      { id: 'first', level: 0, header: 'Existing heading', text: '' },
      { id: 'second', level: 0, text: '' },
    ]);
    expect(getPreviewHints(source).body?.paragraphId).toBe('first');
    const body = preview(source).texFiles['body.tex'];
    expect(body.match(/Your content here/g)).toHaveLength(1);
    expect(body).toContain('Existing');
  });

  it('never generates hints through the tagged PDF adapter', () => {
    const adapter = { inline: (_index: number, _part: string, latex: string) => latex };
    const { texFiles } = generateAllLatexFiles(draft('naval_letter'), undefined, undefined, adapter, { previewHints: true });
    expect(Object.values(texFiles).join('\n')).not.toContain('PreviewHint');
  });

  it('preserves legacy joint memo headings and uses real editor edits in both exports', () => {
    const source = draft('joint_memorandum', {
      subject: 'OLD SHARED SUBJECT', jointSubject: 'LEGACY HEADING', to: 'Old recipient', jointTo: 'Legacy recipient',
    });
    expect(generateAllLatexFiles(source).texFiles['document.tex']).toContain('LEGACY HEADING');
    expect(generateFlatLatex(source)).toContain('LEGACY HEADING');

    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState(source);
      useDocumentStore.getState().setField('subject', 'CURRENT MEMO');
      useDocumentStore.getState().setField('to', 'Current recipient');
      const edited = useDocumentStore.getState();
      for (const output of [generateAllLatexFiles(edited).texFiles['document.tex'], generateFlatLatex(edited)]) {
        expect(output).toContain('CURRENT MEMO');
        expect(output).toContain('Current recipient');
        expect(output).not.toContain('LEGACY HEADING');
      }
    } finally {
      useDocumentStore.setState(original);
    }
  });
});
