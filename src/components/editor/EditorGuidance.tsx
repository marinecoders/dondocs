import type { ReactNode } from 'react';

/** Optional reference material stays next to its fields without delaying editing. */
export function EditorGuidance({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">{title}</summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}
