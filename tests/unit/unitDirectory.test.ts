import { describe, it, expect } from 'vitest';
import { insertUnitInto } from '@/data/unitDirectory';

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
