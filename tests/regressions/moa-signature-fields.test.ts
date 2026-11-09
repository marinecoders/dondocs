import { describe, expect, it } from 'vitest';
import { getDualSignatoryConfig } from '@/services/pdf/finishCorrespondencePdf';
import { moaFixture } from '../_helpers/moaFixture';

describe('MOA/MOU digital signature name lookup', () => {
  it('searches for the same initials printed in both signature blocks', () => {
    expect(getDualSignatoryConfig(moaFixture().formData, 'moa')).toEqual({
      juniorSignatoryName: 'A. T. MORGAN',
      seniorSignatoryName: 'J. M. RIVERA',
    });
  });

  it('leaves empty agreement signers unset', () => {
    expect(getDualSignatoryConfig({ seniorSigName: ' ', juniorSigName: '' }, 'moa')).toEqual({
      juniorSignatoryName: undefined, seniorSignatoryName: undefined,
    });
  });

  it('uses the joint memorandum editor names and respects an explicitly cleared name', () => {
    const data = { ...moaFixture('joint_memorandum').formData,
      jointMemoSeniorSigName: 'Sam K. Woods', jointMemoJuniorSigName: '',
    };
    expect(getDualSignatoryConfig(data, 'joint_memo')).toEqual({
      juniorSignatoryName: undefined, seniorSignatoryName: 'SAM K. WOODS',
    });
  });

  it('preserves legacy joint names when memorandum-specific names are absent', () => {
    expect(getDualSignatoryConfig(moaFixture('joint_memorandum').formData, 'joint_memo')).toEqual({
      juniorSignatoryName: 'ALEX T. MORGAN', seniorSignatoryName: 'JORDAN M. RIVERA',
    });
  });
});
