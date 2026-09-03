import { describe, it, expect } from 'vitest';
import { validateNomenclature, validateLongTitle } from '@/lib/publicationTitle';

describe('publication titles', () => {
  it('lets a two-line nomenclature through and flags a third', () => {
    expect(validateNomenclature('COMBAT OPERATIONS CENTER, AN/TSQ-239(V)4')).toEqual([]);
    expect(validateNomenclature('X'.repeat(130))[0]?.message).toMatch(/two lines/i);
  });

  it('flags a long title past four lines', () => {
    expect(validateLongTitle('INSTALLATION OF THE STOCK ACCESSORY RAIL')).toEqual([]);
    expect(validateLongTitle('WORD '.repeat(70))[0]?.message).toMatch(/four lines/i);
  });

  it('rejects any acronym in the long title, even a common one', () => {
    const [f] = validateLongTitle('Installation of the MCEN rail');
    expect(f.severity).toBe('error');
    expect(f.message).toMatch(/MCEN/);
  });

  it('does not mistake an all-caps title for a row of acronyms', () => {
    expect(validateLongTitle('INSTALLATION OF THE STOCK ACCESSORY RAIL')).toEqual([]);
  });

  it('says nothing about an empty title', () => {
    expect(validateLongTitle('')).toEqual([]);
  });
});
