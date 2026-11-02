import type { ReactNode } from 'react';

export function StockPublicationGroup({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return <fieldset className="min-w-0 space-y-4 border-t pt-5">
    <legend className="pr-3 text-sm font-semibold">{title}</legend>
    {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
    {children}
  </fieldset>;
}
