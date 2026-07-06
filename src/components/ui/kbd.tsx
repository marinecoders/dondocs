import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A small keyboard-shortcut chip, e.g. ⌘K / Esc. Pass `active` on a selected
 * row so the chip inverts against the row's foreground (via currentColor)
 * instead of staying muted-on-muted.
 */
export function Kbd({
  children,
  className,
  active,
}: {
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[16px] items-center justify-center rounded-sm border px-[5px] font-mono text-2xs font-medium leading-none',
        active
          ? 'border-current/25 bg-current/15 text-current'
          : 'border-border bg-muted/60 text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}
