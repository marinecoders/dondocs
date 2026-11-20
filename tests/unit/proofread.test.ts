import { describe, expect, it } from 'vitest';
import { collectProofreadFindings, type ProofreadFinding, type ProofreadSource } from '@/lib/proofread';
import { documentTextFields } from '@/lib/documentFields';
import { detectDocumentTextPII } from '@/services/pii/detector';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';

function source(patch: Partial<ProofreadSource> = {}): ProofreadSource {
  return { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formData: { date: '12 Nov 26', classLevel: 'unclassified' }, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], ...patch };
}

describe('existing checks in one proofread inventory', () => {
  it('collects real check outputs without changing the source or exposing matched sensitive values', () => {
    const input = source({ formData: { date: '2026-11-12', classLevel: 'unclassified' },
      paragraphs: [{ id: 'main', text: 'NATO reference (z). Synthetic ID 123-45-6789.', level: 0, portionMarking: 'S' },
        { id: 'child', text: 'One child.', level: 1 }] });
    const before = structuredClone(input);
    const findings = collectProofreadFindings(input, [{ id: 'signature', label: 'Signature' }]);
    expect(new Set(findings.map(f => f.group))).toEqual(new Set(['required', 'formatting', 'structure', 'acronyms', 'markings', 'references', 'privacy']));
    expect(findings.find(f => f.id === 'formatting:date')?.target).toEqual({ sectionId: 'addressing', field: 'date' });
    expect(findings.find(f => f.id === 'acronym:NATO')?.target.paragraphId).toBe('main');
    expect(findings.some(f => f.group === 'markings' && f.severity === 'error')).toBe(true);
    expect(JSON.stringify(findings.filter(f => f.group === 'privacy'))).not.toContain('123-45-6789');
    expect(input).toEqual(before);
    expect(collectProofreadFindings(input, [{ id: 'signature', label: 'Signature' }])).toEqual(findings);
  });

  it('limits forms to their actual required sections and never imports hidden correspondence findings', () => {
    expect(collectProofreadFindings(source({ documentCategory: 'forms', formData: { date: 'wrong' },
      paragraphs: [{ id: 'hidden', text: 'NATO reference (z)', level: 1 }] }), [{ id: 'marine', label: 'Marine identification' }]))
      .toEqual([{ id: 'required:marine', group: 'required', severity: 'warning', title: 'Marine identification needs attention',
        message: 'Complete the required fields identified in this editor section.', target: { sectionId: 'marine' } }]);
  });

  it('omits numbered-paragraph and hidden-reference checks from compliant business output', () => {
    const findings = collectProofreadFindings(source({ docType: 'business_letter', references: [{ letter: 'z', title: 'Hidden source' }],
      paragraphs: [{ id: 'first', text: 'See reference (q).', level: 1 }] }));
    expect(findings.filter(f => f.group === 'structure' || f.group === 'references')).toEqual([]);
  });

  it('uses publication sections without adding ordinary letterhead/address/signature checks', () => {
    const findings = collectProofreadFindings(source({ docType: 'tm_ietm_front_matter', formData: { date: 'wrong', sigFirst: ' J . ' } }),
      [{ id: 'manual-publication', label: 'Publication' }]);
    expect(findings.map(f => f.target.sectionId)).toEqual(['manual-publication']);
  });

  it('accepts new rules through explicit valid destinations and deduplicates their stable identities', () => {
    const extra: ProofreadFinding = { id: 'extra:subject', group: 'formatting', severity: 'warning', title: 'Subject', message: 'Review subject.', target: { sectionId: 'addressing' } };
    const findings = collectProofreadFindings(source(), [], [extra, extra, { ...extra, id: 'unreachable', target: { sectionId: 'not-rendered' } }]);
    expect(findings).toEqual([extra]);
  });

  it('does not surface a retained inactive field as sensitive output text', () => {
    const findings = collectProofreadFindings(source({ docType: 'mfr', formData: { to: '123-45-6789', subject: 'Record' } }));
    expect(findings.some(f => f.group === 'privacy')).toBe(false);
  });

  it('omits inactive classification text only from proofreading, preserving broader privacy scans', () => {
    const input = source({ formData: { classLevel: 'unclassified', cuiControlledBy: 'cui@example.test', classifiedBy: 'authority@example.test',
      customClassification: 'custom@example.test', pocEmail: 'contact@example.test' } });
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy')).toEqual([]);
    const rendered = generateAllLatexFiles(input).texFiles['classification.tex'];
    expect(rendered).not.toMatch(/cui@example|authority@example|custom@example|contact@example/);
    for (const projection of ['output', 'share', 'backup'] as const) {
      expect(detectDocumentTextPII(documentTextFields(input, projection)).findings).toHaveLength(4);
    }
  });

  it('reviews the classification block actually printed at the effective level', () => {
    const input = source({ formData: { classLevel: 'cui', cuiControlledBy: 'cui@example.test', classifiedBy: 'authority@example.test' } });
    const fields = () => collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target.field);
    expect(fields()).toEqual(['cuiControlledBy']);
    input.paragraphs = [{ id: 'higher', text: 'Synthetic marking control.', level: 0, portionMarking: 'S' }];
    expect(fields()).toEqual(['classifiedBy']);
    input.formData.classLevel = 'custom';
    input.formData.customClassification = 'custom@example.test';
    expect(fields()).toEqual(['customClassification']);
  });

  it('reviews active contact text still printed by Word even when PDF discards it', () => {
    const input = source({ formData: { classLevel: 'cui', pocEmail: 'https://contact@example.test' } });
    expect(generateAllLatexFiles(input).texFiles['classification.tex']).not.toContain('contact@example.test');
    expect(generateFlatLatex(input)).toContain('https://contact@example.test');
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target.field)).toEqual(['pocEmail']);
  });

  it('inspects the rendered ordinary CUI statement once and targets its editable selector', () => {
    const input = source({ formData: { classLevel: 'cui', cuiDistStatement: 'B', distDate: '2026-11-19',
      distReason: 'Synthetic reason 123-45-6789', controllingOffice: 'Synthetic office office@example.test' } });
    expect(generateAllLatexFiles(input).texFiles['classification.tex']).toContain('Synthetic reason 123-45-6789');
    expect(generateAllLatexFiles(input).texFiles['classification.tex']).toContain('office@example.test');
    const findings = collectProofreadFindings(input).filter(f => f.group === 'privacy');
    expect(findings.map(f => f.title)).toEqual(['Social Security Number pattern in Distribution statement',
      'Personal Email Address pattern in Distribution statement']);
    expect(findings.map(f => f.target)).toEqual([{ sectionId: 'classification', field: 'cuiDistStatement' }, { sectionId: 'classification', field: 'cuiDistStatement' }]);
    expect(documentTextFields(input, 'output').find(f => f.path[1] === 'cuiDistStatement')).toBeUndefined();
  });

  it('does not synthesize statement findings for unclassified, custom or publication output', () => {
    const input = source({ formData: { classLevel: 'unclassified', cuiDistStatement: 'B', distDate: '2026-11-19',
      distReason: 'Synthetic reason 123-45-6789', controllingOffice: 'Synthetic office office@example.test' } });
    const statementFindings = () => collectProofreadFindings(input).filter(f => f.target.field === 'cuiDistStatement');
    expect(statementFindings()).toEqual([]);
    input.formData.classLevel = 'custom';input.formData.customClassification = 'CUI';
    expect(statementFindings()).toEqual([]);
    input.formData.classLevel = 'cui';
    for (const docType of ['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter']) {
      input.docType = docType;
      expect(statementFindings()).toEqual([]);
    }
    input.docType = 'naval_letter';input.paragraphs = [{ id: 'higher', text: 'Synthetic higher marking.', level: 0, portionMarking: 'S' }];
    expect(statementFindings()).toEqual([]);
  });

  it('leaves a clean composed distribution statement and determination date unflagged', () => {
    const input = source({ formData: { classLevel: 'cui', cuiDistStatement: 'B', distDate: '2026-11-19',
      distReason: 'Administrative or Operational Use', controllingOffice: 'Training Office' } });
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy')).toEqual([]);
  });

  it('does not throw while reviewing malformed retained statement metadata', () => {
    const input = source({ formData: { classLevel: 'cui', cuiDistStatement: { legacy: true } as never } });
    expect(() => collectProofreadFindings(input)).not.toThrow();
    input.formData.cuiDistStatement = 'B';input.formData.distDate = { legacy: true } as never;
    expect(() => collectProofreadFindings(input)).not.toThrow();
  });

  it('omits overridden legacy joint fields and routes a printed fallback to its current memo input', () => {
    const input = source({ docType: 'joint_memorandum', formData: { jointSeniorSigName: 'legacy@example.test',
      jointMemoSeniorSigName: 'CURRENT SIGNER' } });
    const fields = () => collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target.field);
    expect(fields()).toEqual([]);
    delete input.formData.jointMemoSeniorSigName;
    expect(fields()).toEqual(['jointMemoSeniorSigName']);
    input.formData.jointMemoSeniorSigName = '';
    expect(fields()).toEqual([]);
  });

  it('retains joint address metadata still consumed by the PDF renderer', () => {
    const input = source({ docType: 'joint_memorandum', formData: { jointSeniorFrom: 'printed@example.test' } });
    expect(Object.values(generateAllLatexFiles(input).texFiles).join('\n')).toContain('printed@example.test');
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target.field)).toEqual(['jointSeniorFrom']);
  });

  it('keeps paragraph heading and table-cell identities in privacy destinations', () => {
    const input = source({ paragraphs: [{ id: 'rich', text: '', header: 'Synthetic 123-45-6789', level: 0,
      bodyTable: { headerRows: 1, rows: [['Heading', 'Column'], ['Ordinary', 'Synthetic 321-54-9876']] } }] });
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target))
      .toEqual([{ sectionId: 'body', paragraphId: 'rich', paragraphPath: ['header'] },
        { sectionId: 'body', paragraphId: 'rich', paragraphPath: ['bodyTable', 'rows', 1, 1] }]);
  });

  it('preserves the emitted caption, alternative-text and footnote paths', () => {
    const input = source({ docType: 'i_type', paragraphs: [
      { id: 'figure', text: 'Caption 123-45-6789', level: 0, figure: { altText: 'Alternative 321-54-9876' } },
      { id: 'table', text: '', level: 0, tableKey: 'majorItems', tableFootnotes: [{ id: '1', text: 'Footnote 213-54-9876' }] },
    ] });
    const fields = documentTextFields(input, 'output').filter(field => /Caption|Alternative|Footnote/.test(field.text));
    expect(fields.map(field => field.path)).toEqual([
      ['paragraphs', 0, 'text'], ['paragraphs', 0, 'figure', 'altText'], ['paragraphs', 1, 'tableFootnotes', 0, 'text'],
    ]);
    expect(collectProofreadFindings(input).filter(f => f.group === 'privacy').map(f => f.target.paragraphPath))
      .toEqual([['text'], ['figure', 'altText'], ['tableFootnotes', 0, 'text']]);
  });

  it('retains document-date precision and routes sensitive text to its actual editor section', () => {
    const findings = collectProofreadFindings(source({
      formData: { date: '2026-11-12', unitLine1: 'Synthetic 123-45-6789' },
      paragraphs: [{ id: 'sensitive-body', level: 0, text: 'Synthetic 123-45-6789.' }],
    }));
    expect(findings.filter(f => f.group === 'privacy').map(f => f.target.sectionId)).toEqual(['letterhead', 'body']);
    const moved = collectProofreadFindings(source({ paragraphs: [
      { id: 'new-first', level: 0, text: 'New opening paragraph.' },
      { id: 'sensitive-body', level: 0, text: 'Synthetic 123-45-6789.' },
    ] }));
    expect(moved.find(f => f.target.paragraphId === 'sensitive-body')?.id)
      .toBe(findings.find(f => f.target.paragraphId === 'sensitive-body')?.id);
  });

  it('routes publication table text to the table editor rather than its cover', () => {
    const findings = collectProofreadFindings(source({ docType: 'i_type',
      publicationTables: { examples: [{ values: { description: 'Synthetic 123-45-6789' } }] } }));
    expect(findings.filter(f => f.group === 'privacy').map(f => f.target.sectionId)).toEqual(['tables']);
  });

  it.each([
    ['sl3', 'sl3-cover'],
    ['sl4', 'sl4-cover'],
    ['i_type', 'signature'],
  ])('routes the %s contact finding to its actual %s control section', (docType, sectionId) => {
    const findings = collectProofreadFindings(source({ docType,
      formData: { pocEmail: 'synthetic.contact@example.com', classLevel: 'unclassified' },
    })).filter(finding => finding.group === 'privacy');
    expect(findings).toHaveLength(1);
    expect(findings[0].target).toEqual({ sectionId, field: 'pocEmail' });
  });

});
