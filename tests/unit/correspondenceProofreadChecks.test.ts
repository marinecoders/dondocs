import { describe, expect, it } from 'vitest';
import { additionalProofreadFindings } from '@/lib/correspondenceProofreadChecks';
import { getEditorSections } from '@/lib/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import type { ProofreadSource } from '@/lib/proofread';

function draft(patch: Partial<ProofreadSource> = {}): ProofreadSource {
  return { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formData: { date: '19 Nov 26', subject: 'SYNTHETIC REVIEW' }, paragraphs: [], references: [],
    enclosures: [], copyTos: [], distributions: [], ...patch };
}
const ids = (source: ProofreadSource) => additionalProofreadFindings(source).map(f => f.id);

describe('additional correspondence proofreading', () => {
  it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter', 'unknown'])('avoids ordinary-letter checks for %s', docType => {
    expect(additionalProofreadFindings(draft({ docType, formData: {} }))).toEqual([]);
  });
  it('avoids ordinary-letter checks on forms with retained letter data', () => {
    expect(additionalProofreadFindings(draft({ documentCategory: 'forms', formData: {} }))).toEqual([]);
  });
  it('reports an empty document date without rewriting it or inventing today', () => {
    const source = draft({ formData: { date: '' } }), original = structuredClone(source);
    expect(additionalProofreadFindings(source)).toContainEqual(expect.objectContaining({ id: 'correspondence:date:date', severity: 'warning' }));
    expect(source).toEqual(original);
  });
  it('checks both printed agreement dates, ignoring a stale ordinary-letter date', () => {
    const source = draft({ docType: 'moa', formData: { date: 'OLD', seniorDate: '19 Nov 26', seniorSigName: 'SENIOR', juniorSigName: 'JUNIOR' } });
    expect(ids(source)).toEqual(['correspondence:date:juniorDate']);
  });
  it('uses the joint subject and each command signer', () => {
    const findings = additionalProofreadFindings(draft({ docType: 'joint_letter', formData: { date: '19 Nov 26', jointJuniorDate: '19 Nov 26', subject: 'HIDDEN.', jointSubject: 'PRINTED.', jointSeniorSigName: 'SIGNED' } }));
    expect(findings.map(f => f.id)).toEqual(['correspondence:subject-period', 'correspondence:signer:jointJuniorSigName']);
    expect(findings[0].target.field).toBe('jointSubject');
  });
  it('does not flag a hidden same-page subject but checks its opt-in subject', () => {
    const source = draft({ docType: 'same_page_endorsement', formData: { date: '19 Nov 26', subject: 'HIDDEN.', basicLetterId: 'SOURCE' } });
    expect(ids(source)).not.toContain('correspondence:subject-period');
    source.formData.includeEndorsementSubject = true;
    expect(ids(source)).toContain('correspondence:subject-period');
  });
  it('accepts the same legacy endorsement identification as the renderer', () => {
    expect(ids(draft({ docType: 'new_page_endorsement', formData: { date: '19 Nov 26', subject: 'FIRST ENDORSEMENT on Synthetic source letter' } })))
      .not.toContain('correspondence:endorsement-id');
  });
  it('reports missing enclosure titles and parenthesized missing citations', () => {
    const source = draft({ enclosures: [{ title: '' }], paragraphs: [{ id: 'p1', level: 0, text: 'Use enclosures (1), (2) and (3).' }] });
    const findings = additionalProofreadFindings(source);
    expect(findings).toHaveLength(3);
    expect(findings.filter(f => f.title.startsWith('Check enclosure')).map(f => f.title)).toEqual(['Check enclosure (2)', 'Check enclosure (3)']);
    expect(findings[1].target.paragraphId).toBe('p1');
  });
  it('leaves quoted and code citations alone', () => {
    const source = draft({ paragraphs: [{ level: 0, text: 'Example "enclosure (9)" and `enclosure (8)` and https://example.test/enclosure(7).' }] });
    expect(additionalProofreadFindings(source)).toEqual([]);
  });
  it('honors inherited enclosure numbering without hiding missing new entries', () => {
    const findings = additionalProofreadFindings(draft({ docType: 'new_page_endorsement',
      formData: { date: '19 Nov 26', basicLetterId: 'SOURCE', startingEnclosureNumber: 5 },
      enclosures: [{ title: 'Local enclosure' }], paragraphs: [{ level: 0, text: 'See enclosures (1), (5) and (6).' }] }));
    expect(findings.map(f => f.title)).toEqual(['Check enclosure (6)']);
  });
  it('ignores an inactive formal enclosure list in a compliant business letter', () => {
    expect(additionalProofreadFindings(draft({ docType: 'business_letter', enclosures: [{ title: '' }],
      paragraphs: [{ level: 0, text: 'enclosure (99)' }] }))).toEqual([]);
  });
  it('presents multiline To as an advisory instead of treating every wrapped line as an addressee', () => {
    const f = additionalProofreadFindings(draft({ docType: 'multiple_address_letter', formData: { date: '19 Nov 26', to: 'a\nb\nc\nd\ne' } }));
    expect(f).toHaveLength(1);expect(f[0].message).toMatch(/If these are separate addressees/);
  });
  it('checks CUI completeness only when the CUI configuration is active', () => {
    expect(ids(draft({ formData: { date: '19 Nov 26', classLevel: 'unclassified' } }))).toEqual([]);
    const f = additionalProofreadFindings(draft({ formData: { date: '19 Nov 26', classLevel: 'cui' } }));
    expect(f).toHaveLength(3);expect(f.every(item => item.target.sectionId === 'classification')).toBe(true);
    expect(f.find(item => item.title === 'POC email is empty')?.target.field).toBe('cuiPocEmail');
  });
  it('does not imply that custom CUI-looking banners print a designation block', () => {
    expect(ids(draft({ formData: { date: '19 Nov 26', classLevel: 'custom', customClassification: 'CUI//PRVCY' } }))).toEqual([]);
  });
  it('does not accept a non-email contact that the correspondence renderer would discard', () => {
    const source = draft({ formData: { date: '19 Nov 26', classLevel: 'cui', cuiControlledBy: 'Synthetic office', cuiCategory: 'PRVCY', pocEmail: 'https://example.test' } });
    expect(ids(source)).toEqual(['correspondence:cui:poc-email-invalid']);
    source.formData.pocEmail = 'mailto:office@example.test';expect(ids(source)).toEqual([]);
  });
  it('keeps rule identities stable across text corrections and all targets in a real section', () => {
    for (const docType of Object.keys(DOC_TYPE_CONFIG).filter(type => !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(type))) {
      const source = draft({ docType, formData: { classLevel: 'cui' }, enclosures: [{ title: '' }] });
      const sections = getEditorSections(DOC_TYPE_CONFIG[docType], docType).map(s => s.id);
      for (const f of additionalProofreadFindings(source)) expect(sections, `${docType}: ${f.id}`).toContain(f.target.sectionId);
    }
  });
  it('does not flag executive dates reserved for the signing office', () => {
    for (const docType of ['executive_correspondence', 'standard_memorandum', 'action_memorandum', 'information_memorandum']) {
      expect(ids(draft({ docType, formData: {} })).filter(id => id.startsWith('correspondence:date:'))).toEqual([]);
    }
  });
  it('checks only the junior-command date displayed by a joint letter', () => {
    const source = draft({ docType: 'joint_letter', formData: { jointJuniorDate: '19 Nov 26', jointSeniorSigName: 'SENIOR', jointJuniorSigName: 'JUNIOR' } });
    expect(ids(source)).toEqual([]);
  });
  it('does not treat bracketed starter placeholders as completed dates or signers', () => {
    expect(ids(draft({ docType: 'moa', formData: { seniorDate: '[DATE]', juniorDate: '[DATE]', seniorSigName: '[SIGNER]', juniorSigName: '[SIGNER]' } })))
      .toEqual(['correspondence:date:seniorDate', 'correspondence:date:juniorDate', 'correspondence:signer:seniorSigName', 'correspondence:signer:juniorSigName']);
  });
  it('treats a placeholder CUI contact as incomplete without a duplicate invalid-email finding', () => {
    expect(ids(draft({ formData: { date: '19 Nov 26', classLevel: 'cui', cuiControlledBy: 'OFFICE', cuiCategory: 'PRVCY', pocEmail: '[EMAIL]' } })))
      .toEqual(['correspondence:cui:pocEmail']);
  });
  it('does not check a CUI block when higher portions cause a classified block to print', () => {
    const source = draft({ formData: { date: '19 Nov 26', classLevel: 'cui' }, paragraphs: [{ level: 0, text: 'Synthetic marking test.', portionMarking: 'S' }] });
    expect(ids(source)).toEqual([]);
  });

  it('reviews only enabled appended endorsements, including populated extra entries', () => {
    const source = draft({ formData: { date: '19 Nov 26', appendEndorsement: true,
      additionalEndorsements: [{ id: 'unused' }, { id: 'second', endorsementSigLast: 'EXAMPLE' }] } });
    expect(additionalProofreadFindings(source).map(f => f.target.field)).toEqual(['first-endorsement-body', 'second-body']);
    source.formData.appendEndorsement = false;
    expect(ids(source)).toEqual([]);
    source.formData.appendEndorsement = true;
    source.docType = 'business_letter';
    expect(ids(source)).toEqual([]);
  });

  it('checks explicit enclosure citations in printed appended endorsement text', () => {
    const source = draft({ formData: { date: '19 Nov 26', appendEndorsement: true,
      endorsementBody: 'See enclosure (3).', additionalEndorsements: [{ id: 'second', endorsementBody: 'See enclosure (4).' }] } });
    expect(additionalProofreadFindings(source).filter(f => f.id.includes('enclosure-citation')).map(f => f.target))
      .toEqual([{ sectionId: 'signature', field: 'first-endorsement-body' }, { sectionId: 'signature', field: 'second-body' }]);
  });

  it('uses the rendered legacy joint-memo signer fallback, preserving explicitly cleared memo names', () => {
    const source = draft({ docType: 'joint_memorandum', formData: { date: '19 Nov 26',
      jointSeniorSigName: 'SYNTHETIC SENIOR', jointJuniorSigName: 'SYNTHETIC JUNIOR' } });
    expect(ids(source)).toEqual([]);
    source.formData.jointMemoSeniorSigName = '';
    expect(ids(source)).toEqual(['correspondence:signer:jointMemoSeniorSigName']);
  });

  it.each([
    '**enclosure** (2)', 'enclosure **(2)**', '__enclosure (2)__',
    '**__enclosure__** *(2)*', String.raw`\textbf{enclosure} (2)`,
  ])('checks the visible citation through supported emphasis: %s', text => {
    const source = draft({ paragraphs: [{ id: 'formatted', level: 0, text: `See ${text}.` }], enclosures: [{ title: 'Existing enclosure' }] });
    const original = structuredClone(source);
    const findings = additionalProofreadFindings(source);
    expect(findings.map(f => f.title)).toEqual(['Check enclosure (2)']);
    expect(findings[0].target).toEqual({ sectionId: 'body', paragraphId: 'formatted' });
    expect(source).toEqual(original);
  });

  it.each([
    '**"enclosure (2)"**', '__`enclosure (2)`__', 'https://example.test/enclosure(2)',
    'enclosure "example" (2)', 'enclosure `(2)`',
  ])('does not expose protected text or join across it after emphasis projection: %s', text => {
    expect(additionalProofreadFindings(draft({ paragraphs: [{ id: 'literal', level: 0, text }], enclosures: [{ title: 'Existing enclosure' }] }))).toEqual([]);
  });

  it('checks formatted citations in enabled appended text and retains its editor target', () => {
    const source = draft({ formData: { date: '19 Nov 26', appendEndorsement: true, endorsementBody: 'See **enclosure** (2).' } });
    expect(additionalProofreadFindings(source).filter(f => f.id.includes('enclosure-citation')).map(f => f.target))
      .toEqual([{ sectionId: 'signature', field: 'first-endorsement-body' }]);
    source.formData.appendEndorsement = false;
    expect(additionalProofreadFindings(source)).toEqual([]);
  });

});
