import { expect, it, vi } from 'vitest';
import { fixturePage } from '../_helpers/formFixture';

it('keeps retained template fixture bytes stable across clock boundaries', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = await fixturePage();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    const later = await fixturePage();
    expect(later.sha256).toBe(first.sha256);
    expect(later.bytes).toEqual(first.bytes);
  } finally { vi.useRealTimers(); }
});
