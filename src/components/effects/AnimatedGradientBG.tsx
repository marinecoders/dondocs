import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface AnimatedGradientBGProps {
  children?: ReactNode;
  className?: string;
}

export function AnimatedGradientBG({ children, className }: AnimatedGradientBGProps) {
  return (
    <div
      className={cn('relative overflow-hidden', className)}
    >
      <div
        className="absolute inset-0 animated-gradient-bg opacity-90"
        style={{
          background: `
            radial-gradient(ellipse at 20% 50%, oklch(0.32 0.06 230 / 0.8) 0%, transparent 60%),
            radial-gradient(ellipse at 80% 20%, oklch(0.50 0.18 25 / 0.4) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 80%, oklch(0.80 0.14 85 / 0.3) 0%, transparent 50%),
            linear-gradient(135deg, oklch(0.15 0.025 260) 0%, oklch(0.22 0.04 240) 50%, oklch(0.15 0.025 260) 100%)
          `,
          backgroundSize: '200% 200%',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
