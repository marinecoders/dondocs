import { describe, expect, it } from 'vitest';
import { inspectCuiRegistryMarkings, normalizeCuiRegistryMarkings } from '@/lib/cuiRegistryMarkings';

describe('CUI Registry marking syntax', () => {
  it('recognizes official category names, codes, and specified markings with distinct meanings', () => {
    expect(normalizeCuiRegistryMarkings({
      cuiCategory: 'general privacy, PRVCY; Child Victim/Witness\nSP-CTI',
    })).toEqual({ cuiCategory: 'PRVCY, CVIC, SP-CTI' });
  });

  it.each(['Other', 'Privacy', 'Legal', 'SP-CVIC', 'PRVCY, unofficial category'])('requires review of %s', cuiCategory => {
    expect(inspectCuiRegistryMarkings({ cuiCategory }).issues).toEqual([expect.objectContaining({ field: 'cuiCategory' })]);
  });

  it('recognizes fixed and recipient controls, ordering country and coalition codes separately', () => {
    expect(normalizeCuiRegistryMarkings({
      cuiDissemination: 'fedcon; rel to usa, fvey, gbr, can, CAN, NATO; display only USA, AUS',
    })).toEqual({ cuiDissemination: 'FEDCON/REL TO USA, CAN, GBR, FVEY, NATO/DISPLAY ONLY USA, AUS' });
  });

  it.each(['NOFRN', 'UNAUTHORIZED', 'REL TO USA', 'REL TO USA, LIST', 'REL TO USA; CAN', 'REL TO GBR, USA', 'DISPLAY ONLY USA, ZZZ'])('requires review of %s', cuiDissemination => {
    expect(inspectCuiRegistryMarkings({ cuiDissemination }).issues).toEqual([expect.objectContaining({ field: 'cuiDissemination' })]);
  });

  it('requires Legal Privilege for attorney dissemination controls', () => {
    expect(inspectCuiRegistryMarkings({ cuiCategory: 'PRVCY', cuiDissemination: 'Attorney-Client' }).issues).toEqual([
      expect.objectContaining({ field: 'cuiDissemination', message: expect.stringContaining('Legal Privilege') }),
    ]);
    expect(normalizeCuiRegistryMarkings({ cuiCategory: 'Legal Privilege', cuiDissemination: 'ATTORNEY-WP' })).toEqual({
      cuiCategory: 'PRIVILEGE',
      cuiDissemination: 'Attorney-WP',
    });
  });
});
