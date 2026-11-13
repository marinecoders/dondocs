import { describe, expect, it } from 'vitest';
import { mechanicalFindings, type MechanicalSource } from '@/lib/mechanicalCorrections';

function source(text: string): MechanicalSource {
  return { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    paragraphs: [{ text, level: 0 }], references: [] };
}

describe('reviewed body date rules', () => {
  it('requires an audience and never infers one from the document family', () => {
    expect(mechanicalFindings(source('Due 05 Nov 2026.'), 'body', null)).toEqual([]);
    for (const docType of ['naval_letter', 'business_letter', 'executive_memorandum']) {
      const state = { ...source('Due 05 Nov 2026.'), docType };
      expect(mechanicalFindings(state, 'body', 'military')[0].after).toBe('5 November 2026');
      expect(mechanicalFindings(state, 'body', 'civilian')[0].after).toBe('November 5, 2026');
    }
  });
  it.each([
    ['05 Nov 2026', '5 November 2026'], ['November 5, 2026', '5 November 2026'],
    ['29 FEB 2024', '29 February 2024'], ['1\tjan\t2026', '1 January 2026'],
    ['10 Nov 1775', '10 November 1775'], ['1 Jan 1900', '1 January 1900'], ['5 Nov 2100', '5 November 2100'],
  ])('retains the known calendar date while formatting %j for military body text', (before, after) => {
    const state = source(`Due ${before}.`);
    const [item] = mechanicalFindings(state, 'body', 'military');
    expect(item).toMatchObject({ ruleId: 'body-date-standard', before, after, sourceText: state.paragraphs[0].text });
    expect(state.paragraphs[0].text.slice(item.target.start, item.target.end)).toBe(before);
  });
  it.each(['5 November 2026', '1 January 2026'])('does not propose an already-correct standard date: %s', text => {
    expect(mechanicalFindings(source(text), 'body', 'military')).toEqual([]);
  });
  it('emits separate spans for repeated occurrences without changing surrounding text', () => {
    const text = 'From 05 Nov 2026 through 05 Nov 2026; review 6 December 2026.';
    const findings = mechanicalFindings(source(text), 'body', 'military');
    expect(findings.map(item => item.before)).toEqual(['05 Nov 2026', '05 Nov 2026']);
    expect(new Set(findings.map(item => item.id)).size).toBe(2);
    expect(findings.map(item => text.slice(item.target.start, item.target.end))).toEqual(['05 Nov 2026', '05 Nov 2026']);
  });
  it.each(['5 Nov 26', 'November 5, 26', '31 April 2026', '29 Feb 2026', '1 Jan 0000', '29 Feb 1900', '29 Feb 2100'])('leaves unclear or invalid %j advisory', text => {
    const [item] = mechanicalFindings(source(text), 'body', 'civilian');
    expect(item.before).toBe(text);
    expect(item).not.toHaveProperty('after');
  });
  it.each([
    '"Due 05 Nov 2026."', "'Due 05 Nov 2026.'", '“Due 05 Nov 2026.”',
    '"Due\n05 Nov 2026."', '`Due 05 Nov 2026.`', '```\n05 Nov 2026\n```',
    '> Due 05 Nov 2026.', '{{Due 05 Nov 2026}}', '[Due 05 Nov 2026]', '[[Due 05 Nov 2026]]',
    'HTTPS://example.com/05 Nov 2026', 'file/05 Nov 2026', 'report-05 Nov 2026.docx',
    '05/11/2026', '2026-11-05', '5 November 20261', 'A05 Nov 2026',
  ])('does not edit protected, numeric or identifier-like text: %j', text => {
    expect(mechanicalFindings(source(text), 'body', 'military')).toEqual([]);
  });
  it('recognizes an ordinary date outside a protected region', () => {
    const items = mechanicalFindings(source('"5 Nov 2026" is quoted; use 6 Dec 2026.'), 'body', 'military');
    expect(items.map(item => item.before)).toEqual(['6 Dec 2026']);
  });
  it.each(['figure', 'tableKey', 'callout', 'procedure', 'appendix'] as const)('leaves special %s paragraph content outside scope', field => {
    const state = source('5 Nov 2026');
    state.paragraphs = [{ ...state.paragraphs[0], [field]: field === 'figure' ? {} : field === 'callout' ? 'note' : field === 'tableKey' ? 'table' : true }];
    expect(mechanicalFindings(state, 'body', 'military')).toEqual([]);
  });
  it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter', 'joint_letter', 'moa', 'unknown', 'constructor'])('keeps %s outside the first correction scope', docType => {
    expect(mechanicalFindings({ ...source('5 Nov 2026'), docType }, 'body', 'military')).toEqual([]);
  });
  it('does not apply correspondence rules to forms', () => {
    expect(mechanicalFindings({ ...source('5 Nov 2026'), documentCategory: 'forms' }, 'body', 'military')).toEqual([]);
  });
});

describe('existing NOTAL marker formatting', () => {
  it.each(['(notal)', '(Notal)', '( NOTAL )', '(\tnotal\t)'])('normalizes only the existing terminal %j marker', before => {
    const state = source('');
    state.references = [{ letter: 'g', title: `CO instruction ${before}  `, url: 'https://example.com/source' }];
    const [item] = mechanicalFindings(state, 'references', null);
    expect(item).toMatchObject({ ruleId: 'reference-notal-marker', before, after: '(NOTAL)', label: 'Reference (g) NOTAL marker' });
    expect(state.references[0].url).toBe('https://example.com/source');
  });
  it.each(['CO instruction NOTAL', 'NOTAL', 'CO instruction (NOTAL)', 'CO (notal) instruction',
    '"CO instruction (notal)"', 'https://example.com/(notal)', '{{SOURCE (notal)}}'])('does not invent status or edit a literal: %j', title => {
    const state = source('');state.references = [{ letter: 'a', title }];
    expect(mechanicalFindings(state, 'references', null)).toEqual([]);
  });
  it('respects the formal reference capability', () => {
    const state = { ...source(''), docType: 'business_letter', references: [{ letter: 'a', title: 'Instruction (notal)' }] };
    expect(mechanicalFindings(state, 'references', null)).toEqual([]);
    expect(mechanicalFindings({ ...state, documentMode: 'custom' }, 'references', null)).toHaveLength(1);
  });
});
