import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openPackageEditDraft } from '@/lib/packageEditDrafts';

const binaryIdentities = new WeakMap<ArrayBuffer | Blob, number>();
let binarySequence = 0;
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!(item instanceof ArrayBuffer) && !(item instanceof Blob)) return item;
    if (!binaryIdentities.has(item)) binaryIdentities.set(item, ++binarySequence);
    return { binary: binaryIdentities.get(item), bytes: item instanceof Blob ? item.size : item.byteLength };
  });
}

export function usePackageEditDraft<T>({ scope, value, dirty, enabled, restore }: {
  scope: string;
  value: T;
  dirty: boolean;
  enabled: boolean;
  restore(value: unknown, isCurrent: () => boolean): void | Promise<void>;
}) {
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState('');
  const restoreRef = useRef(restore), alive = useRef(true), revision = useRef(0);
  const session = useRef<{ scope: string; store: Awaited<ReturnType<typeof openPackageEditDraft>>; last: string | null; blocked: boolean } | null>(null);
  const serialized = fingerprint(value), valueRef = useRef(value);
  const loading = status === 'loading';
  useLayoutEffect(() => { restoreRef.current = restore; valueRef.current = value; });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    session.current = null; revision.current++;
    queueMicrotask(() => { if (current) { setError(''); setStatus(enabled ? 'loading' : 'idle'); } });
    if (!enabled) return;
    void openPackageEditDraft(scope).then(async store => {
      if (!current) return;
      const loaded = { scope, store, last: store.value === null ? null : fingerprint(store.value), blocked: true };
      session.current = loaded;
      if (store.error) throw new Error(store.error);
      if (store.value !== null) await restoreRef.current(store.value, () => current);
      if (!current) return;
      loaded.blocked = false;
      setStatus(store.value === null ? 'idle' : 'saved');
    }).catch(cause => { if (current) { setError(cause instanceof Error ? cause.message : 'Local draft recovery is unavailable.'); setStatus('error'); } });
    return () => { current = false; };
  }, [scope, enabled]);
  useEffect(() => {
    const current = session.current;
    if (!enabled || !current || current.scope !== scope || current.blocked) return;
    const next = dirty ? serialized : null;
    if (next === current.last) return;
    current.last = next;
    const write = ++revision.current;
    queueMicrotask(() => { if (alive.current && session.current === current && revision.current === write) { setStatus('saving'); setError(''); } });
    void current.store.save(next === null ? null : valueRef.current).then(() => {
      if (alive.current && session.current === current && revision.current === write) setStatus(next === null ? 'idle' : 'saved');
    }).catch(cause => {
      if (alive.current && session.current === current && revision.current === write) { current.last = null; setStatus('error'); setError(cause instanceof Error ? cause.message : 'Your edits could not be saved for recovery.'); }
    });
  }, [scope, serialized, dirty, enabled, loading]);
  useEffect(() => {
    if (!dirty || status !== 'saving' && status !== 'error') return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, status]);
  return { status, error, clear: async () => {
    const current = session.current;
    if (!current) return;
    setStatus('saving');
    try {
      await current.store.save(null); current.last = null; current.blocked = false;
      if (alive.current && session.current === current) { setError(''); setStatus('idle'); }
    } catch (cause) {
      if (alive.current && session.current === current) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'The local draft could not be discarded.'); }
      throw cause;
    }
  } };
}
