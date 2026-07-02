import { describe, it, expect } from 'vitest';
import { swapReducer, initialSwapState, type SwapState } from '@/components/pdf/usePdfDocumentSwap';

const url = (n: number) => `blob:test/${n}`;

function run(events: Parameters<typeof swapReducer>[1][], from: SwapState = initialSwapState): SwapState {
  return events.reduce(swapReducer, from);
}

describe('pdf document swap machine', () => {
  it('first URL activates directly — nothing to double-buffer', () => {
    const s = run([{ type: 'URL_CHANGED', url: url(1) }]);
    expect(s.active?.url).toBe(url(1));
    expect(s.incoming).toBeNull();
  });

  it('a recompile stages the new document as incoming, keeping the active one', () => {
    const s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
    ]);
    expect(s.active?.url).toBe(url(1)); // still showing the old doc
    expect(s.incoming?.url).toBe(url(2));
  });

  it('newest wins: rapid recompiles replace the in-flight incoming', () => {
    const s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
      { type: 'URL_CHANGED', url: url(3) },
    ]);
    expect(s.active?.url).toBe(url(1));
    expect(s.incoming?.url).toBe(url(3)); // url(2) was coalesced away
  });

  it('READY promotes the incoming document', () => {
    let s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
    ]);
    s = swapReducer(s, { type: 'INCOMING_READY', gen: s.incoming!.gen });
    expect(s.active?.url).toBe(url(2));
    expect(s.incoming).toBeNull();
  });

  it('the safety timeout promotes exactly like READY', () => {
    let s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
    ]);
    s = swapReducer(s, { type: 'READY_TIMEOUT', gen: s.incoming!.gen });
    expect(s.active?.url).toBe(url(2));
  });

  it('stale-generation events are ignored (a coalesced doc cannot promote)', () => {
    let s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
    ]);
    const staleGen = s.incoming!.gen;
    s = swapReducer(s, { type: 'URL_CHANGED', url: url(3) }); // supersedes url(2)
    s = swapReducer(s, { type: 'INCOMING_READY', gen: staleGen });
    expect(s.active?.url).toBe(url(1)); // stale ready did nothing
    expect(s.incoming?.url).toBe(url(3));
    s = swapReducer(s, { type: 'INCOMING_READY', gen: s.incoming!.gen });
    expect(s.active?.url).toBe(url(3));
  });

  it('a failed incoming load keeps the active document (revoked-blob race)', () => {
    let s = run([
      { type: 'URL_CHANGED', url: url(1) },
      { type: 'URL_CHANGED', url: url(2) },
    ]);
    s = swapReducer(s, { type: 'INCOMING_FAILED', gen: s.incoming!.gen });
    expect(s.active?.url).toBe(url(1));
    expect(s.incoming).toBeNull();
  });

  it('re-emitting the active URL with no incoming is a no-op', () => {
    const s1 = run([{ type: 'URL_CHANGED', url: url(1) }]);
    const s2 = swapReducer(s1, { type: 'URL_CHANGED', url: url(1) });
    expect(s2).toBe(s1);
  });
});
