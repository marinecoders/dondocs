import { cloneElement, isValidElement, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type TriggerProps = { 'aria-label'?: string; 'aria-labelledby'?: string };

/**
 * A themed tooltip for a single interactive control (usually an icon-only
 * button). Use this instead of the native `title=` attribute: `title` tooltips
 * are un-themed, ~500ms-delayed, and — critically — invisible to keyboard focus
 * and touch, so the hint never reaches those users.
 *
 * Radix's Tooltip only wires `aria-describedby` (a *description*); an icon-only
 * trigger still needs an accessible *name*. So we inject `aria-label` from the
 * same `label` unless the caller already set a name, letting one prop cover the
 * visible tooltip, the description, and the name.
 *
 * Relies on the single app-root <TooltipProvider> for delay/skip coordination —
 * do not nest a Provider here.
 */
export function IconTip({
  label,
  side,
  children,
}: {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement<TriggerProps>;
}) {
  const trigger =
    isValidElement(children) &&
    !children.props['aria-label'] &&
    !children.props['aria-labelledby']
      ? cloneElement(children, { 'aria-label': label })
      : children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
