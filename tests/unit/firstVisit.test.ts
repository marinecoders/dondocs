import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The answer is captured when the module first loads, so each case loads a
// fresh copy against the storage it sets up.
async function loadFresh() {
  vi.resetModules();
  return (await import('@/lib/firstVisit')).isFirstVisit();
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('isFirstVisit', () => {
  it('is true when this browser has stored nothing', async () => {
    expect(await loadFresh()).toBe(true);
  });

  it('is false once any earlier visit left something behind', async () => {
    localStorage.setItem('dondocs_ui', '{}');
    expect(await loadFresh()).toBe(false);
  });

  it('keeps the answer from load time after this visit writes', async () => {
    vi.resetModules();
    const { isFirstVisit } = await import('@/lib/firstVisit');
    localStorage.setItem('dondocs_ui', '{}');
    expect(isFirstVisit()).toBe(true);
  });

  it('counts blocked storage as a return visit', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    expect(await loadFresh()).toBe(false);
  });
});
