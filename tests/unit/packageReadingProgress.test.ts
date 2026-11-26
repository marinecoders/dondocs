import { afterEach, expect, it, vi } from 'vitest';
import { markPackageReading, packageReadingState } from '@/lib/packageReadingProgress';

const binding = { packageId: 'package', memberId: 'member', memberDigest: 'a'.repeat(64) };

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('keeps reading separate for duplicate forms, revisions, and packages', () => {
  expect(packageReadingState(binding, 0)).toBe('unread');
  expect(markPackageReading(binding, 0, true)).toBe(true);
  expect(packageReadingState(binding, 0)).toBe('read');
  expect(packageReadingState(binding, 1)).toBe('moved');
  expect(packageReadingState({ ...binding, memberDigest: 'b'.repeat(64) }, 0)).toBe('changed');
  expect(packageReadingState({ ...binding, memberId: 'copy' }, 0)).toBe('unread');
  expect(packageReadingState({ ...binding, packageId: 'other' }, 0)).toBe('unread');
  expect(markPackageReading(binding, 1, false)).toBe(true);
  expect(packageReadingState(binding, 1)).toBe('unread');
});

it('never treats a damaged mark as read', () => {
  markPackageReading(binding, 0, true);
  const key = localStorage.key(0)!;
  localStorage.setItem(key, '{}');
  expect(packageReadingState(binding, 0)).toBe('unread');
});
