import { useEffect, useMemo, useState } from 'react';
import { Scissors, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { abbrevSetForForm, type AbbrevEntry } from '@/data/abbreviations';
import {
  buildAbbrevIndex,
  scanAbbreviations,
  applyMatches,
  type AbbrevIndex,
  type AbbrevMatch,
} from '@/lib/abbreviations';

const MAX_SHOWN = 12;

/**
 * Suggests the authorized abbreviations (issue #25) for a recordkeeping field.
 * As the drafter types, it lists the full words/phrases in the field that have
 * an approved abbreviation for the active order (the IRAM set on the AA / Page 11
 * forms) and lets them apply one — or all — with a click. Suggestion only; it
 * never rewrites the field on its own, and it stays hidden until something in the
 * text actually has an approved abbreviation.
 *
 * Applies by the scanned, non-overlapping spans (not a global word replace), so
 * applying "service" can't clobber the "service record" phrase suggestion.
 *
 * The ~1,600-entry dataset is loaded on demand the first time a governed field
 * mounts, so it never touches the initial bundle.
 */
export function AbbreviationHelper({
  value,
  onChange,
  formType,
}: {
  value: string;
  onChange: (next: string) => void;
  formType: string | undefined;
}) {
  const set = abbrevSetForForm(formType);
  const [index, setIndex] = useState<AbbrevIndex | null>(null);

  useEffect(() => {
    if (!set) return;
    let alive = true;
    set
      .load()
      .then((entries) => {
        if (alive) setIndex(buildAbbrevIndex(entries));
      })
      .catch(() => {
        /* the dataset just won't be available; the field still works */
      });
    return () => {
      alive = false;
    };
  }, [set]);

  const matches = useMemo(() => (index ? scanAbbreviations(value, index) : []), [value, index]);

  // Unique entries in first-occurrence order, each with the spans it occupies.
  const groups = useMemo(() => {
    const byWord = new Map<string, { entry: AbbrevEntry; matches: AbbrevMatch[] }>();
    for (const m of matches) {
      const key = m.entry.word.toLowerCase();
      const g = byWord.get(key);
      if (g) g.matches.push(m);
      else byWord.set(key, { entry: m.entry, matches: [m] });
    }
    return [...byWord.values()];
  }, [matches]);

  if (!set || groups.length === 0) return null;

  const shown = groups.slice(0, MAX_SHOWN);

  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Scissors className="h-4 w-4 text-primary" />
          Approved abbreviations
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange(applyMatches(value, matches))}
        >
          Apply all ({groups.length})
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shown.map((g) => (
          <button
            key={g.entry.word}
            type="button"
            onClick={() => onChange(applyMatches(value, g.matches))}
            aria-label={`Replace "${g.entry.word}" with "${g.entry.abbr}"`}
            title={`Replace "${g.entry.word}" with "${g.entry.abbr}"`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-secondary/40"
          >
            <span className="text-muted-foreground">{g.entry.word.toLowerCase()}</span>
            <span aria-hidden>→</span>
            <span className="font-medium">{g.entry.abbr}</span>
          </button>
        ))}
        {groups.length > MAX_SHOWN && (
          <span className="self-center text-xs text-muted-foreground">+{groups.length - MAX_SHOWN} more</span>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {set.label} ({set.authority}). Use abbreviations only where they&apos;re clearly understood.
      </p>
    </div>
  );
}
