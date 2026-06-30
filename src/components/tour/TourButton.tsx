import type { ComponentProps } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type TourButtonProps = ComponentProps<typeof Button> & {
  /**
   * Adds a directional affordance: a trailing arrow for "next" / forward
   * actions, a leading chevron for "back". Omit for plain actions.
   */
  arrow?: 'next' | 'back';
};

/**
 * Shared action button for every guided surface (tour, feature walkthroughs,
 * welcome letter, getting-started checklist) so their controls stay consistent.
 *
 * Defaults to the compact tour size and primary look; a "back" arrow uses the
 * ghost variant. Both are overridable via Button props.
 */
export function TourButton({ arrow, variant, size = 'sm', children, ...props }: TourButtonProps) {
  return (
    <Button variant={variant ?? (arrow === 'back' ? 'ghost' : 'default')} size={size} {...props}>
      {arrow === 'back' && <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {arrow === 'next' && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
    </Button>
  );
}
