import { useEffect, useReducer, useRef } from 'react';

/**
 * Double-buffered document swap — the machinery behind the flicker-free
 * recompile. The active document stays fully rendered while the incoming one
 * loads and pre-renders in a hidden layer; only once the pages the user is
 * looking at have actually painted does the new layer get promoted (a short
 * crossfade in the component). The compile loop re-emits a new blob URL every
 * ~1.5s while the user types, so the machine coalesces: a newer URL simply
 * replaces the in-flight incoming document (newest wins), and a load failure
 * abandons the incoming quietly — App revokes old blob URLs eagerly, so a
 * mid-flight revocation is expected and a fresher URL always follows.
 *
 * The reducer is pure and exported for unit tests
 * (tests/unit/pdfSwapMachine.test.ts).
 */

export interface DocSlot {
  url: string;
  /** Monotonic generation — stale async events (loads/renders/timeouts from a
   *  superseded document) are ignored by comparing generations. */
  gen: number;
}

export interface SwapState {
  active: DocSlot | null;
  incoming: DocSlot | null;
  /** Generation counter (last issued). */
  gen: number;
}

export type SwapEvent =
  | { type: 'URL_CHANGED'; url: string }
  | { type: 'INCOMING_LOADED'; gen: number }
  | { type: 'INCOMING_READY'; gen: number }
  | { type: 'READY_TIMEOUT'; gen: number }
  | { type: 'INCOMING_FAILED'; gen: number };

export const initialSwapState: SwapState = { active: null, incoming: null, gen: 0 };

export function swapReducer(state: SwapState, event: SwapEvent): SwapState {
  switch (event.type) {
    case 'URL_CHANGED': {
      const gen = state.gen + 1;
      const slot = { url: event.url, gen };
      // First document: no old content to protect — activate directly and let
      // the layer render with the surface's normal loading state.
      if (!state.active) return { active: slot, incoming: null, gen };
      // Same URL re-emitted (e.g. parent re-render): nothing to do.
      if (state.active.url === event.url && !state.incoming) return state;
      // Replace any in-flight incoming — newest wins.
      return { ...state, incoming: slot, gen };
    }
    case 'INCOMING_READY':
    case 'READY_TIMEOUT': {
      // Promote the incoming document once its restore-window pages have
      // painted (or the safety timeout fires so a slow render can't wedge the
      // preview on stale content forever).
      if (!state.incoming || state.incoming.gen !== event.gen) return state;
      return { active: state.incoming, incoming: null, gen: state.gen };
    }
    case 'INCOMING_FAILED': {
      // Blob revoked mid-load or parse failure: keep showing the active
      // document. The next compile emits a fresh URL within the debounce.
      if (!state.incoming || state.incoming.gen !== event.gen) return state;
      return { ...state, incoming: null };
    }
    case 'INCOMING_LOADED':
      // Structural no-op in the reducer (the layer drives pre-rendering), but
      // kept as an event so the hook can arm the READY_TIMEOUT from it.
      return state;
    default:
      return state;
  }
}

/** How long after load we wait for the restore-window pages to paint before
 *  promoting anyway — keeps a pathological render from pinning stale content. */
export const READY_TIMEOUT_MS = 1200;

export function usePdfDocumentSwap(pdfUrl: string) {
  const [state, dispatch] = useReducer(swapReducer, initialSwapState);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dispatch({ type: 'URL_CHANGED', url: pdfUrl });
  }, [pdfUrl]);

  // Arm the promote-anyway timeout when an incoming document finishes loading.
  const onIncomingLoaded = (gen: number) => {
    dispatch({ type: 'INCOMING_LOADED', gen });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => dispatch({ type: 'READY_TIMEOUT', gen }), READY_TIMEOUT_MS);
  };
  const onIncomingReady = (gen: number) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: 'INCOMING_READY', gen });
  };
  const onIncomingFailed = (gen: number) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: 'INCOMING_FAILED', gen });
  };

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  return { state, onIncomingLoaded, onIncomingReady, onIncomingFailed };
}
