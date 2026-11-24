import { describe, it, expect } from 'vitest';
import { insertUnitInto, loadUnitDirectory, searchUnitDirectory, type UnitInfo } from '@/data/unitDirectory';

// The unit-lookup insert used by the To/Via addressing fields. Three branches:
// fill-when-empty, replace-a-bracketed-placeholder, and append-after-a-comma.
describe('insertUnitInto', () => {
  it('fills an empty field with the unit name', () => {
    expect(insertUnitInto('', '1st Marine Division')).toBe('1st Marine Division');
    expect(insertUnitInto('   ', '1st Marine Division')).toBe('1st Marine Division');
  });

  it('replaces a bracketed placeholder wholesale', () => {
    expect(insertUnitInto('[RECIPIENT]', '2d Marine Division')).toBe('2d Marine Division');
    expect(insertUnitInto('[TO]', '2d Marine Division')).toBe('2d Marine Division');
  });

  it('appends after existing content with a comma', () => {
    expect(insertUnitInto('Commanding Officer', '2d MARDIV')).toBe('Commanding Officer, 2d MARDIV');
  });

  it('does not double the comma when the field already ends in one', () => {
    expect(insertUnitInto('Commanding Officer,', '2d MARDIV')).toBe('Commanding Officer, 2d MARDIV');
    expect(insertUnitInto('Commanding Officer, ', '2d MARDIV')).toBe('Commanding Officer, 2d MARDIV');
  });
});

describe('searchUnitDirectory', () => {
  it('finds qualified codes precisely and puts exact matches ahead of partial matches', () => {
    const partial: UnitInfo = { name: 'Alpha', address: '', uic: 'M12345' };
    const matchingRuc: UnitInfo = { name: 'Bravo', address: '', ruc: '12345' };
    const sharedRuc: UnitInfo = { name: 'Charlie', address: '', ruc: '12345' };
    const units = [partial, matchingRuc, sharedRuc];
    expect(searchUnitDirectory(units, '12345')).toEqual([matchingRuc, sharedRuc, partial]);
    expect(searchUnitDirectory(units, ' rUc: 12345 ')).toEqual([matchingRuc, sharedRuc]);
    expect(searchUnitDirectory(units, 'UIC M12345')).toEqual([partial]);
    expect(searchUnitDirectory(units, 'MCC 12345')).toEqual([]);
  });

  it('preserves bundled identifiers, sourced former names and existing text lookup', async () => {
    const { ALL_UNITS } = await loadUnitDirectory();
    const [wingUnit] = searchUnitDirectory(ALL_UNITS, 'RUC:00910');
    expect(wingUnit).toMatchObject({ mcc: '1PC', ruc: '00910', uic: 'M00910' });
    expect(searchUnitDirectory(ALL_UNITS, 'mcc 1pc')).toContain(wingUnit);
    expect(searchUnitDirectory(ALL_UNITS, 'kaneohe bay')).toContain(wingUnit);
    expect(searchUnitDirectory(ALL_UNITS, '1st laad macg-18')).toContain(wingUnit);
    const [regiment] = searchUnitDirectory(ALL_UNITS, '3rd marine regiment');
    expect(regiment.uic).toBe('M13100');
    expect(searchUnitDirectory(ALL_UNITS, '3d marine regiment')).toContain(regiment);
    expect(searchUnitDirectory(ALL_UNITS, 'uiC n65888')[0]).toMatchObject({
      name: 'FLEET READINESS CENTER SOUTHWEST', service: 'USN',
    });
  });
});
