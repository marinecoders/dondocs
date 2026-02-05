import { cn } from '@/lib/utils';

interface TextRevealProps {
  text: string;
  className?: string;
  delayMs?: number;
}

export function TextReveal({ text, className, delayMs = 120 }: TextRevealProps) {
  const words = text.split(' ');

  return (
    <span className={cn('inline-flex flex-wrap gap-x-[0.25em]', className)}>
      {words.map((word, i) => (
        <span
          key={i}
          className="text-reveal-word"
          style={{ animationDelay: `${i * delayMs}ms` }}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
