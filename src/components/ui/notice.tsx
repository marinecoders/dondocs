import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Token-backed severity notice. One flat tint + border per variant, driven by
 * the theme CSS vars (--primary/--warning/--destructive/--success) so every
 * scheme (default, navy, usmc, …) restains from one source instead of the
 * hardcoded palette reds/ambers/oranges/blues that used to drift across modals.
 * GOV.UK-style flat panel — no decorative gradients.
 *
 * The container carries the tint; give the leading icon and any heading the
 * matching accent token so the whole notice reads as one severity:
 *   info → text-primary · warning → text-warning · error → text-destructive ·
 *   success → text-success
 */
const variantClasses = {
  info: 'bg-primary/8 border-primary/25',
  warning: 'bg-warning/10 border-warning/30',
  error: 'bg-destructive/10 border-destructive/30',
  success: 'bg-success/10 border-success/30',
} as const;

export type NoticeVariant = keyof typeof variantClasses;

export function Notice({
  variant = 'info',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { variant?: NoticeVariant }) {
  return (
    <div
      data-slot="notice"
      className={cn('rounded-md border p-3', variantClasses[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
}
