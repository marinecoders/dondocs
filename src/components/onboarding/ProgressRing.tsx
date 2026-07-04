import { Check } from 'lucide-react';

/**
 * A small circular progress ring with the count in the middle. The arc fills
 * clockwise from twelve o'clock (the `-rotate-90` flips the SVG's 3-o'clock
 * start); at full it swaps the count for a green check. `pathLength={total}`
 * lets the dash math read in whole steps regardless of the real circumference.
 */
export function ProgressRing({ size, done, total }: { size: number; done: number; total: number }) {
  const complete = done >= total;
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          stroke="currentColor"
          className="text-muted-foreground/25"
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke="currentColor"
          pathLength={total}
          strokeDasharray={total}
          strokeDashoffset={total - done}
          className="text-primary transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inline-flex items-center justify-center text-[11px] font-semibold tabular-nums leading-none text-foreground">
        {complete ? <Check className="h-3 w-3 text-success" /> : `${done}/${total}`}
      </span>
    </span>
  );
}
