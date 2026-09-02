import { describe, it, expect } from 'vitest';
import { composeDistributionStatement, DISTRIBUTION_REASONS } from '@/data/techpub/distributionStatements';
import { validateDistributionFillIns } from '@/lib/classificationValidation';

// The wording is the MARCORSYSCOM template's, with the author's fill-ins in
// the places it leaves for them.
describe('composeDistributionStatement', () => {
  const fill = { reason: 'Critical Technology', date: '1 December 2024', office: 'PM IW' };

  it('A takes no fill-ins', () => {
    expect(composeDistributionStatement('A', fill)).toBe('DISTRIBUTION STATEMENT A: Approved for public release. Distribution is unlimited.');
  });

  it('B through E carry the reason, the date, and the office', () => {
    expect(composeDistributionStatement('D', fill)).toBe(
      'DISTRIBUTION STATEMENT D: Distribution authorized to the Department of Defense and U.S. DoD contractors only (Critical Technology) (1 December 2024). Other requests must be referred to PM IW.'
    );
    // B and C say "for this document", as the template does.
    expect(composeDistributionStatement('B', fill)).toMatch(/Other requests for this document must be referred to PM IW\.$/);
  });

  it('F names the office and the date', () => {
    expect(composeDistributionStatement('F', fill)).toBe(
      'DISTRIBUTION STATEMENT F: Further dissemination only as directed by PM IW (1 December 2024) or higher DoD authority.'
    );
  });

  it('leaves a missing part out rather than printing a placeholder', () => {
    expect(composeDistributionStatement('D')).toBe(
      'DISTRIBUTION STATEMENT D: Distribution authorized to the Department of Defense and U.S. DoD contractors only.'
    );
    expect(composeDistributionStatement('D')).not.toMatch(/\(\)/);
  });

  it('is empty when nothing is chosen', () => {
    expect(composeDistributionStatement('')).toBe('');
    expect(DISTRIBUTION_REASONS).toContain('Export Controlled');
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
