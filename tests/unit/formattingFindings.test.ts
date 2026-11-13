import { describe, expect, it } from 'vitest';
import { formattingFindings, type FormattingInput } from '@/lib/formattingFindings';

const base: FormattingInput = {
  docType: 'naval_letter', documentCategory: 'correspondence', documentMode: 'compliant', formData: {},
};
function date(value: string, input: Partial<FormattingInput> = {}) {
  const state = { ...base, ...input, formData: { date: value } };
  return formattingFindings(state, 'addressing');
}

describe('mechanical formatting findings', () => {
  it.each([
    ['2026-11-12', '12 Nov 26'],
    ['November 12, 2026', '12 Nov 26'],
    ['12 November 2026', '12 Nov 26'],
    [' 01 JAN 2026 ', '1 Jan 26'],
    ['01\tNov\t26', '1 Nov 26'],
    ['13/04/2026', '13 Apr 26'],
    ['04/13/2026', '13 Apr 26'],
    ['04/04/2026', '4 Apr 26'],
    ['2024-02-29', '29 Feb 24'],
  ])('offers an exact military date replacement for %j', (before, after) => {
    expect(date(before)).toEqual([expect.objectContaining({ field: 'date', before, after })]);
  });

  it.each(['03/04/2026', '04/03/2026', '11/12/26', '2026-02-29', '31 Apr 2026', '2026-00-01', '2026-01-00', '2026-13-01', 'tomorrow', 'November 2026', '2026-11-12T00:00:00Z', '12 Nov\n2026'])('leaves %j for manual review', value => {
    const findings = date(value);
    expect(findings).toHaveLength(1);
    expect(findings[0]).not.toHaveProperty('after');
  });

  it.each(['', ' ', '[DATE]', '{{DATE}}', '12 Nov 26', '29 Feb 24'])('does not flag blank, placeholder or correct military dates: %j', value => {
    expect(date(value)).toEqual([]);
  });

  it('uses the business date style only in compliant mode', () => {
    expect(date('2026-11-12', { docType: 'business_letter' })[0].after).toBe('November 12, 2026');
    expect(date('November 12, 2026', { docType: 'business_letter' })).toEqual([]);
    expect(date('2026-11-12', { docType: 'business_letter', documentMode: 'custom' })[0].after).toBe('12 Nov 26');
  });

  it('does not invent a century when a spelled date needs a four-digit year', () => {
    expect(date('12 Nov 26', { docType: 'business_letter' })[0]).not.toHaveProperty('after');
  });

  it('uses the executive field’s spelled style in either mode', () => {
    for (const documentMode of ['compliant', 'custom'] as const) {
      const input = { ...base, docType: 'action_memorandum', documentMode, formData: { date: '2026-11-12' } };
      expect(formattingFindings(input, 'executive')[0].after).toBe('November 12, 2026');
      expect(formattingFindings(input, 'addressing')).toEqual([]);
    }
  });

  it.each([
    [' J . ', 'J.'], ['\tR.\t', 'R.'], ['a .', 'a.'],
  ])('only removes spacing from an explicit single initial: %j', (before, after) => {
    expect(formattingFindings({ ...base, formData: { sigFirst: before } }, 'signature'))
      .toEqual([expect.objectContaining({ field: 'sigFirst', before, after })]);
  });

  it.each(['J.', 'J', 'John', 'J.R.', 'J. R.', 'Mary Jane', 'Jean-Paul', 'J..', 'J.\n', '[INITIAL]', '{{FIRST}}'])('preserves names, multi-initial and unclear values: %j', sigFirst => {
    expect(formattingFindings({ ...base, formData: { sigFirst } }, 'signature')).toEqual([]);
  });

  it('keeps each initial in its own field and section', () => {
    const input = { ...base, formData: { sigFirst: ' J . ', sigMiddle: ' R . ', sigLast: 'Doe' } };
    expect(formattingFindings(input, 'signature').map(f => [f.field, f.after])).toEqual([['sigFirst', 'J.'], ['sigMiddle', 'R.']]);
    expect(formattingFindings(input, 'body')).toEqual([]);
    expect(input.formData).toEqual({ sigFirst: ' J . ', sigMiddle: ' R . ', sigLast: 'Doe' });
  });

  it.each(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter', 'moa', 'mou', 'joint_letter', 'unknown', 'constructor'])('does not apply the initial correspondence scope to %s', docType => {
    const input = { ...base, docType, formData: { date: '2026-11-12', sigFirst: ' J . ' } };
    expect(formattingFindings(input, 'addressing')).toEqual([]);
    expect(formattingFindings(input, 'signature')).toEqual([]);
  });

  it('leaves recordkeeping forms to their existing correction tools', () => {
    expect(date('2026-11-12', { documentCategory: 'forms' })).toEqual([]);
  });
});
