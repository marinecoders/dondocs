import { useEffect, useState } from 'react';

type LookupState<T> =
  | { status: 'loading'; data: null }
  | { status: 'error'; data: null; error: string }
  | { status: 'ready'; data: T };

/** Load on first open, retain successful data, and allow an explicit retry. */
export function useLookupData<T>(open: boolean, load: () => Promise<T>) {
  const [state, setState] = useState<LookupState<T>>({ status: 'loading', data: null });
  const status = state.status;

  useEffect(() => {
    if (!open || status !== 'loading') return;
    let cancelled = false;
    void load().then(
      (data) => { if (!cancelled) setState({ status: 'ready', data }); },
      (error: unknown) => { if (!cancelled) setState({ status: 'error', data: null, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
  }, [open, status, load]);

  return { ...state, retry: () => setState({ status: 'loading', data: null }) };
}
