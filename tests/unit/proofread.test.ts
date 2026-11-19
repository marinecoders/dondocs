import { describe, expect, it } from 'vitest';
import { collectProofreadFindings, type ProofreadFinding, type ProofreadSource } from '@/lib/proofread';

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
});
