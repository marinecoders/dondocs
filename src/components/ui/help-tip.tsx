import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HelpTipProps {
  /** Tooltip body — the help text shown on hover/focus. */
  children: React.ReactNode;
  /** Accessible name for the trigger. Defaults to "More information". */
  label?: string;
  /** Side the tooltip opens on. Defaults to "right". */
  side?: React.ComponentProps<typeof TooltipContent>['side'];
  /** Extra classes for the trigger button (rarely needed). */
  className?: string;
  /** Extra classes for the tooltip content panel. */
  contentClassName?: string;
}

/**
 * Accessible "?" help affordance: a focusable icon button that reveals its
 * tooltip on hover AND keyboard focus.
 *
 * Replaces the old pattern of a bare <HelpCircle> SVG used directly as a
 * TooltipTrigger — an SVG isn't focusable and carries no accessible name, so
 * that guidance was mouse-only. Self-contained (its own TooltipProvider) so it
 * drops into any context, including isolated tests — matching the prior markup,
 * where each help tooltip already carried its own provider.
 */
export function HelpTip({
  children,
  label = 'More information',
  side = 'right',
  className,
  contentClassName,
}: HelpTipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            // Help icons frequently sit inside accordion triggers; clicking the
            // icon must not toggle the surrounding section.
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              className
            )}
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className={cn('max-w-xs', contentClassName)}>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
