import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A small keyboard-shortcut chip, e.g. ⌘K / Esc. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[16px] items-center justify-center rounded-[5px] border border-border',
        'bg-muted/60 px-[5px] font-mono text-[11px] font-medium leading-none text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}
