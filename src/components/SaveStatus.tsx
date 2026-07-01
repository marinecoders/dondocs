import { useEffect, useReducer } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

function savedAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Passive "Saved · <time>" indicator reflecting the real last persist (the
 * registry write for correspondence, formStore's persist for forms). Renders
 * nothing until the first save. Replaces the old manual-save toast theater so
 * the UI honestly shows that work is being kept automatically.
 */
export function SaveStatus({ className }: { className?: string }) {
  const lastSavedAt = useUIStore((s) => s.lastSavedAt);
  const saveStatus = useUIStore((s) => s.saveStatus);
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (lastSavedAt == null) return;
    const id = window.setInterval(refresh, 30_000); // keep the relative time fresh
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  const base = className ?? 'text-xs text-muted-foreground';

  if (saveStatus === 'saving') {
    return (
      <span className={`inline-flex items-center gap-1 ${base}`} aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (saveStatus === 'error') {
    return (
      <span
        className={`inline-flex items-center gap-1 ${className ?? 'text-xs'} text-destructive`}
        role="status"
        title="The document couldn't be written to this browser's storage. Use Download or Share to keep a copy."
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        Couldn&apos;t save
      </span>
    );
  }
  if (lastSavedAt == null) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${base}`}>
      <Check className="h-3 w-3 text-[var(--success)]" aria-hidden />
      Saved · {savedAgo(lastSavedAt)}
    </span>
  );
}
