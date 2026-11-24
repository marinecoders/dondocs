import { expect, it } from 'vitest';
import { windowEnvelopeLayout, windowEnvelopeProblems, windowEnvelopeRows } from '@/lib/windowEnvelope';
import type { DocumentData } from '@/types/document';

const fieldData: Partial<DocumentData> = {
  windowEnvelope: 'standard', unitLine1: 'TRAINING COMMAND', subject: 'TRAINING', to: 'COMMANDER\n123 TRAINING ROAD\nQUANTICO VA 22134',
};

it('checks the address width and line count, Via routing and all declared markings', () => {
  expect(windowEnvelopeProblems('naval_letter', fieldData, [], [])).toEqual([]);
  expect(windowEnvelopeProblems('naval_letter', { ...fieldData, via: 'ROUTING OFFICE', to: 'W'.repeat(100) + '\n2\n3\n4\n5\n6' }, [], []))
    .toEqual(expect.arrayContaining([expect.stringContaining('Via'), expect.stringContaining('five lines'), expect.stringContaining('middle')]));
  expect(windowEnvelopeProblems('naval_letter', fieldData, [], [{ title: 'Restricted', marking: { classLevel: 'cui' } }]))
    .toEqual([expect.stringContaining('unclassified enclosures')]);
});

it('isolates the two layouts and holds the business greeting at the same slot regardless of address length', () => {
  expect(windowEnvelopeLayout('standard_letter', fieldData)).toBeUndefined();
  const short = windowEnvelopeRows('salutation', { ...fieldData, to: 'RECIPIENT', salutation: 'Dear Ms. Example:' });
  const long = windowEnvelopeRows('subject', { ...fieldData, to: '1\n2\n3\n4\n5' });
  expect(short.find(row => row.kind === 'address')?.top).toBe(180);
  expect(long.find(row => row.kind === 'address')?.top).toBe(180);
  expect(short.at(-1)).toEqual({ top: 288, text: 'Dear Ms. Example:', kind: 'heading', field: 'salutation' });
  expect(long.at(-1)).toEqual({ top: 288, text: 'SUBJECT:  TRAINING', kind: 'heading', field: 'subject' });
});

it('requests the full year for a business window letter with an ambiguous stored date', () => {
  const data = { ...fieldData, windowEnvelope: 'salutation' as const, salutation: 'Dear Directors:', date: '23 Nov 26' };
  expect(windowEnvelopeProblems('business_letter', data, [], [])).toContain('Enter a valid date. Use a four-digit year for a business letter.');
  expect(windowEnvelopeProblems('business_letter', { ...data, date: '23 Nov 2026' }, [], [])).toEqual([]);
});
