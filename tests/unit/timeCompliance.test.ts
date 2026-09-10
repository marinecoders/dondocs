import { describe, it, expect } from 'vitest';
import { validateTimeCompliance } from '@/lib/timeCompliance';

const today = new Date('2026-01-01T00:00:00Z');
const plusDays = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString();

describe('time compliance period', () => {
  it('leaves a NORMAL instruction alone — its period is one year by default', () => {
    expect(validateTimeCompliance('normal', undefined, today)).toEqual([]);
    expect(validateTimeCompliance('normal', plusDays(900), today)).toEqual([]);
  });

  it('requires a completion date when URGENT', () => {
    const [f] = validateTimeCompliance('urgent', '', today);
    expect(f.severity).toBe('error');
    expect(f.message).toMatch(/must give a completion date/i);
  });

  it('accepts an URGENT period inside a year', () => {
    expect(validateTimeCompliance('urgent', plusDays(200), today)).toEqual([]);
    expect(validateTimeCompliance('urgent', plusDays(365), today)).toEqual([]);
  });

  it('rejects an URGENT period beyond a year', () => {
    const [f] = validateTimeCompliance('urgent', plusDays(366), today);
    expect(f.severity).toBe('error');
    expect(f.message).toMatch(/within one year/i);
  });

  it('flags a date already gone by', () => {
    const [f] = validateTimeCompliance('urgent', plusDays(-1), today);
    expect(f.severity).toBe('warning');
  });

  it('says so when the date cannot be read', () => {
    const [f] = validateTimeCompliance('urgent', 'sometime soon', today);
    expect(f.severity).toBe('error');
  });
});
