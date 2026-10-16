import { describe, it, expect } from 'vitest';
import { validateIdentifiers } from '@/lib/identifiers';

const ok = { pcn: '184 123456 00', shortTitle: 'MI 12345A-24/1', publicationType: 'MI', endItems: [{ nsn: '5895-01-520-4360', tamcn: 'A02557G', id: '11031A', model: 'V4' }], majorItems: [] };

describe('validateIdentifiers', () => {
  it.each(['MI 12345-26/1', 'TI 6115-26/2', 'LI 4790-26/1', 'SI 12345-26/1'])('accepts assigned basic-number form %s', (shortTitle) => {
    expect(validateIdentifiers({ ...ok, shortTitle, publicationType: shortTitle.slice(0, 2) })).toEqual([]);
  });
  it.each(['I', 'O'])('rejects %s as an ID suffix', (suffix) => {
    expect(validateIdentifiers({ ...ok, shortTitle: `MI 12345${suffix}-26/1` }).join(' ')).not.toBe('');
    expect(validateIdentifiers({ ...ok, endItems: [{ ...ok.endItems[0], id: `12345${suffix}` }] })).toHaveLength(1);
  });
  it('accepts the template\'s own examples, with or without spaces in the PCN', () => {
    expect(validateIdentifiers(ok)).toEqual([]);
    expect(validateIdentifiers({ ...ok, pcn: '18412345600' })).toEqual([]);
    expect(validateIdentifiers({ ...ok, endItems: [{ ...ok.endItems[0], nsn: '5895015204360' }] })).toEqual([]);
  });

  it('names a PCN, short title, NSN, TAMCN or I.D. number of the wrong shape', () => {
    const m = validateIdentifiers({ ...ok, pcn: '1234', shortTitle: 'MI-12345', endItems: [{ nsn: '5895-520', tamcn: 'A0255G', id: '1103', model: '' }] }).map((f) => f.message);
    expect(m).toEqual([
      'A PCN is eleven digits, as 184 123456 00.',
      'Use the publication type, assigned ID/FSC/SSIC basic number, year and sequence, as MI 12345A-24/1. ID suffixes exclude I and O.',
      'An NSN is thirteen digits, as 5895-01-520-4360: 5895-520.',
      'A TAMCN is seven positions, as A02557G: A0255G.',
      'An I.D. number is five digits and a letter other than I or O, as 11031A: 1103.',
    ]);
  });

  it('notices a short title whose type disagrees with the publication type', () => {
    expect(validateIdentifiers({ ...ok, publicationType: 'TI' })[0].message).toBe('The short title names a MI but the publication type is TI.');
  });

  it('checks Major Items rows as it checks end items, and says nothing about blanks', () => {
    expect(validateIdentifiers({ ...ok, endItems: [], majorItems: [{ values: { nsn: '', tamcn: 'BAD', id: '' } }] })[0].message).toMatch(/TAMCN.*BAD/);
    expect(validateIdentifiers({ pcn: '', shortTitle: '', endItems: [], majorItems: [] })).toEqual([]);
  });
});
