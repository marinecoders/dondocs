import { describe, expect, it } from 'vitest';
import { mechanicalFindings, type MechanicalSource } from '@/lib/mechanicalCorrections';
import { planReferenceChange, scanReferenceCitations } from '@/lib/referenceCitations';

function source(text: string): MechanicalSource {
  return { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    paragraphs: [{ text, level: 0 }], references: [] };
}

describe('quoted mechanical correction boundaries', () => {
  it('preserves dates in fenced code containing nested backticks', () => {
    const state = source('```javascript\nconst deadline = `05 Nov 2026`;\n```\nAttend 06 Dec 2026.');
    expect(mechanicalFindings(state, 'body', 'military').map(item => item.before)).toEqual(['06 Dec 2026']);
  });

  it.each([
    '~~~javascript\nconst deadline = `05 Nov 2026`;\n~~~',
    '````text\n```\n05 Nov 2026\n```\n````',
    '``literal ` token 05 Nov 2026``',
    '```text\nA quote " and 05 Nov 2026\n```',
  ])('preserves code delimiters and parses the prose after %j independently', code => {
    expect(mechanicalFindings(source(`${code}\nAttend 06 Dec 2026.`), 'body', 'military').map(item => item.before)).toEqual(['06 Dec 2026']);
  });

  it.each([':', '—', '='])('preserves a single-quoted date immediately after %s', prefix => {
    const state = source(`Quoted${prefix}'Due 05 Nov 2026.' Attend 06 Dec 2026.`);
    expect(mechanicalFindings(state, 'body', 'military').map(item => item.before)).toEqual(['06 Dec 2026']);
  });

  it('preserves an unclosed single-quoted reference marker after punctuation', () => {
    const state = { ...source(''), references: [{ letter: 'a', title: "Quoted:'Instruction ( notal )" }] };
    expect(mechanicalFindings(state, 'references', null)).toEqual([]);
  });

  it.each([':', '—', '='])('blocks reference relettering when a quoted citation follows %s', prefix => {
    const state = source(`Quoted${prefix}'reference (b)' Follow reference (a).`);
    const plan = planReferenceChange({ ...state, paragraphs: [...state.paragraphs], formData: {},
      references: [{ letter: 'a', title: 'Alpha' }, { letter: 'b', title: 'Bravo' }], copyTos: [], distributions: [] }, [1, 0]);
    expect(plan.blockers.join(' ')).toContain('quoted text');
  });

  it.each(["It's", "René's", "Cafe\u0301's", "5'10"])('does not treat the apostrophe within %j as an opening quote', prefix => {
    expect(mechanicalFindings(source(`${prefix} due 05 Nov 2026.`), 'body', 'military').map(item => item.before)).toEqual(['05 Nov 2026']);
    const scan = scanReferenceCitations(`${prefix} reference (b) applies.`);
    expect(scan.issues).toEqual([]);
    expect(scan.citations.map(item => item.letter)).toEqual(['b']);
  });

  it('does not close a quoted literal at an internal contraction apostrophe', () => {
    expect(mechanicalFindings(source("Quoted:'It's due 05 Nov 2026.' Attend 06 Dec 2026."), 'body', 'military')
      .map(item => item.before)).toEqual(['06 Dec 2026']);
    const scan = scanReferenceCitations("Quoted:'Chief's reference (b)' Follow reference (a).");
    expect(scan.issues.join(' ')).toContain('quoted text');
    expect(scan.citations.map(item => item.letter)).toEqual(['a']);
  });

  it('also preserves internal curly apostrophes inside curly-quoted literals', () => {
    expect(mechanicalFindings(source('Quoted:‘It’s due 05 Nov 2026.’ Attend 06 Dec 2026.'), 'body', 'military')
      .map(item => item.before)).toEqual(['06 Dec 2026']);
    const scan = scanReferenceCitations('Quoted:‘Chief’s reference (b)’ Follow reference (a).');
    expect(scan.issues.join(' ')).toContain('quoted text');
    expect(scan.citations.map(item => item.letter)).toEqual(['a']);
    expect(mechanicalFindings(source('Staff’s deadline is 05 Nov 2026.'), 'body', 'military')
      .map(item => item.before)).toEqual(['05 Nov 2026']);
  });
});
