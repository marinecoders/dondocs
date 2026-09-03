import { describe, it, expect } from 'vitest';
import { composeDistributionStatement, DISTRIBUTION_REASONS, reasonsFor } from '@/data/techpub/distributionStatements';
import { validateDistributionFillIns, validateReasonForStatement } from '@/lib/classificationValidation';

// The wording is DoDI 5230.24's (January 2023), with the author's fill-ins in
// the places it leaves for them.
describe('composeDistributionStatement', () => {
  const fill = { reason: 'Critical Technology', date: '1 December 2024', office: 'PM IW' };

  it('A takes no fill-ins', () => {
    expect(composeDistributionStatement('A', fill)).toBe('DISTRIBUTION STATEMENT A: Approved for public release: distribution is unlimited.');
  });

  it('B through E carry the reason, the date, and the office', () => {
    expect(composeDistributionStatement('D', fill)).toBe(
      'DISTRIBUTION STATEMENT D: Distribution authorized to Department of Defense and U.S. DoD contractors only (Critical Technology) (1 December 2024). Other requests for this document must be referred to PM IW.'
    );
    expect(composeDistributionStatement('B', fill)).toMatch(/Other requests for this document must be referred to PM IW\.$/);
  });

  it('F names the office and the date', () => {
    expect(composeDistributionStatement('F', fill)).toBe(
      'DISTRIBUTION STATEMENT F: Further distribution only as directed by PM IW (1 December 2024) or higher DoD authority.'
    );
  });

  it('leaves a missing part out rather than printing a placeholder', () => {
    expect(composeDistributionStatement('D')).toBe(
      'DISTRIBUTION STATEMENT D: Distribution authorized to Department of Defense and U.S. DoD contractors only.'
    );
    expect(composeDistributionStatement('D')).not.toMatch(/\(\)/);
  });

  it('is empty when nothing is chosen', () => {
    expect(composeDistributionStatement('')).toBe('');
    expect(DISTRIBUTION_REASONS).toContain('Export Controlled');
  });

  it('offers each statement the reasons the instruction pairs it with', () => {
    expect(reasonsFor('E')).toContain('Direct Military Support');
    expect(reasonsFor('D')).not.toContain('Direct Military Support');
    expect(reasonsFor('C')).not.toContain('Test and Evaluation');
    expect(reasonsFor('B')).toContain('Test and Evaluation');
    expect(reasonsFor('A')).toEqual([]);
  });
});

describe('validateReasonForStatement', () => {
  it('flags a reason the statement may not carry, and a reason the instruction does not list', () => {
    expect(validateReasonForStatement('D', 'Direct Military Support')[0].message).toBe('Direct Military Support goes with Statement E, not D.');
    expect(validateReasonForStatement('C', 'Operations Security')[0].message).toBe('Operations Security goes with Statement B or E, not C.');
    expect(validateReasonForStatement('D', 'Premature Dissemination')[0].message).toMatch(/not a reason DoDI 5230.24 lists/);
    expect(validateReasonForStatement('D', 'Critical Technology')).toEqual([]);
    expect(validateReasonForStatement('A', 'Critical Technology')).toEqual([]);
  });
});

describe('validateDistributionFillIns', () => {
  it('says nothing for A or for a complete statement', () => {
    expect(validateDistributionFillIns('A', {})).toEqual([]);
    expect(validateDistributionFillIns('D', { reason: 'r', date: 'd', office: 'o' })).toEqual([]);
  });

  it('names what B through E still need', () => {
    expect(validateDistributionFillIns('D', {})[0].message).toBe(
      'Distribution Statement D still needs a reason, a date of determination and the controlling office (on the Cover).'
    );
    expect(validateDistributionFillIns('C', { reason: 'r', office: 'o' })[0].message).toBe('Distribution Statement C still needs a date of determination.');
  });

  it('asks F for the office and the date, not a reason', () => {
    expect(validateDistributionFillIns('F', { date: 'd', office: 'o' })).toEqual([]);
    expect(validateDistributionFillIns('F', { office: 'o' })[0].message).toMatch(/needs a date of determination\.$/);
  });
});
