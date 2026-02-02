import { useMemo } from 'react';
import { cn } from '@/lib/utils';

function generateBeamPaths(count: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const y = -120 + i * 28;
    const cp1y = y + 30;
    const cp2y = y + 90;
    const yEnd = y + 120;
    paths.push(`M-200 ${y}C400 ${cp1y} 1200 ${cp2y} 1800 ${yEnd}`);
  }
  return paths;
}

function generateGridPaths(spacing: number): string {
  const paths: string[] = [];
  for (let y = -160; y <= 950; y += spacing) {
    const cp1y = y + 30;
    const cp2y = y + 90;
    const yEnd = y + 120;
    paths.push(`M-200 ${y}C400 ${cp1y} 1200 ${cp2y} 1800 ${yEnd}`);
  }
  return paths.join('');
}

// Pre-generate desktop versions (static — no need to recompute)
const DESKTOP_BEAMS = generateBeamPaths(22);
const DESKTOP_GRID = generateGridPaths(14);
const MOBILE_BEAMS = generateBeamPaths(8);
const MOBILE_GRID = generateGridPaths(28);

interface BackgroundBeamsProps {
  className?: string;
  reducedMotion?: boolean;
}

export function BackgroundBeams({ className, reducedMotion = false }: BackgroundBeamsProps) {
  const beamPaths = reducedMotion ? MOBILE_BEAMS : DESKTOP_BEAMS;
  const gridPaths = reducedMotion ? MOBILE_GRID : DESKTOP_GRID;
  return (
    <div className={cn('absolute inset-0 flex h-full w-full items-center justify-center pointer-events-none', className)}>
      <svg
        className="pointer-events-none absolute z-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 1600 900"
        fill="none"
        preserveAspectRatio="none"
      >
        {/* Static grid of all paths - very faint */}
        <path
          d={gridPaths}
          stroke="url(#beams-radial)"
          strokeOpacity="0.05"
          strokeWidth="0.5"
        />

        {/* Animated beams with staggered CSS animations */}
        {beamPaths.map((path, i) => (
          <path
            key={i}
            d={path}
            stroke={`url(#beam-grad-${i})`}
            strokeOpacity="0.35"
            strokeWidth="0.5"
          />
        ))}

        <defs>
          {/* Animated gradients for each beam */}
          {beamPaths.map((_, i) => (
            <linearGradient
              key={i}
              id={`beam-grad-${i}`}
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#a6192e" stopOpacity="0">
                <animate
                  attributeName="offset"
                  values={`${-0.5 - i * 0.06};${0.6 + i * 0.03}`}
                  dur={`${10 + i * 1.0}s`}
                  repeatCount="indefinite"
                />
              </stop>
              <stop stopColor="#a6192e">
                <animate
                  attributeName="offset"
                  values={`${-0.3 - i * 0.06};${0.8 + i * 0.03}`}
                  dur={`${10 + i * 1.0}s`}
                  repeatCount="indefinite"
                />
              </stop>
              <stop offset="0.325" stopColor="#991B20">
                <animate
                  attributeName="offset"
                  values={`${-0.1 - i * 0.06};${1.0 + i * 0.03}`}
                  dur={`${10 + i * 1.0}s`}
                  repeatCount="indefinite"
                />
              </stop>
              <stop stopColor="#f1b434" stopOpacity="0">
                <animate
                  attributeName="offset"
                  values={`${0.1 - i * 0.06};${1.2 + i * 0.03}`}
                  dur={`${10 + i * 1.0}s`}
                  repeatCount="indefinite"
                />
              </stop>
            </linearGradient>
          ))}

          {/* Radial gradient for the static grid */}
          <radialGradient
            id="beams-radial"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(800 450) rotate(90) scale(500 1200)"
          >
            <stop offset="0.067" stopColor="currentColor" />
            <stop offset="0.4" stopColor="currentColor" />
            <stop offset="0.7" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}
