/**
 * The directory answers the abbreviations people use.
 *
 * MIU's seven entries carried the full name as their abbreviation, so the
 * one thing anyone types for it found nothing; `abbrev` is a search field in
 * the companion and in the app's unit modal alike, so the data is the fix.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { lookupUnits } from '../../companion/unitLookup';

describe('unit abbreviations', () => {
  it('finds MIU by its abbreviation, and narrows by location', async () => {
    expect((await lookupUnits('MIU')).total).toBe(7);
    const newburgh = await lookupUnits('MIU Newburgh');
    expect(newburgh.total).toBe(1);
    expect(newburgh.matches[0].mcc).toBe('SVP');
  });

  it('still returns nothing for an abbreviation the directory does not record', async () => {
    expect((await lookupUnits('ZZQX')).total).toBe(0);
  });
});
