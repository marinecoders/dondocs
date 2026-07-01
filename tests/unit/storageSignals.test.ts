import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeLocalStorage, lastWriteFailed, compressedLocalStorage } from '@/lib/compressedStorage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('safeLocalStorage — write outcomes are recorded, not just swallowed', () => {
  it('flags a failed write and clears the flag once a write lands', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    // Restore in finally rather than via afterEach: restoreAllMocks doesn't
    // reliably un-spy a host object's method across all runtimes (same pattern
    // as compressedStorage.property.test.ts).
    try {
      safeLocalStorage.setItem('dondocs-forms', '{"a":1}');
      expect(lastWriteFailed('dondocs-forms')).toBe(true);
    } finally {
      spy.mockRestore();
    }
    safeLocalStorage.setItem('dondocs-forms', '{"a":2}');
    expect(lastWriteFailed('dondocs-forms')).toBe(false);
  });

  it('tracks failures per persist key', () => {
    safeLocalStorage.setItem('dondocs_ui', '{}');
    expect(lastWriteFailed('dondocs_ui')).toBe(false);
    expect(lastWriteFailed('never-written')).toBe(false);
  });
});

describe('compressedLocalStorage — a corrupt payload is stashed, not destroyed', () => {
  it('returns null for a corrupt gz: value and keeps the raw payload recoverable', () => {
    localStorage.setItem('dondocs_profiles', 'gz:!!!not-base64-deflate!!!');
    expect(compressedLocalStorage.getItem('dondocs_profiles')).toBeNull();
    // The store resets to defaults, but the only copy of the user's data
    // survives under a sibling key instead of being overwritten by the next
    // persist write.
    expect(localStorage.getItem('dondocs_profiles.corrupt')).toBe('gz:!!!not-base64-deflate!!!');
  });
});
