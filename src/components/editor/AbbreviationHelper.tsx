import { useEffect, useMemo, useState } from 'react';
import { Scissors, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { abbrevSetForForm, loadCommonWords, type AbbrevEntry } from '@/data/abbreviations';
import {
  buildAbbrevIndex,
  scanAbbreviations,
  scanTypos,
  applyMatches,
  makeCommonWordLookup,
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
  const [nearestCommonWord, setNearestCommonWord] = useState<((token: string) => string | null) | null>(null);

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
    // The common-word guard for the fuzzy pass is a separate chunk; without it,
    // the exact suggestions still work — we just don't offer typo corrections.
    loadCommonWords()
      .then((words) => {
        if (alive) setNearestCommonWord(() => makeCommonWordLookup(words));
      })
      .catch(() => {
        /* no fuzzy suggestions, exact matching is unaffected */
      });
    return () => {
      alive = false;
    };
  }, [set]);

  const matches = useMemo(() => (index ? scanAbbreviations(value, index) : []), [value, index]);

  // Tentative "did you mean" corrections for likely misspellings — only once the
  // common-word guard has loaded, so we never offer one without it.
  const typos = useMemo(
    () => (index && nearestCommonWord ? scanTypos(value, index, nearestCommonWord) : []),
    [value, index, nearestCommonWord]
  );

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

  // Distinct misspellings (first-occurrence order), each with the span to fix.
  const typoGroups = useMemo(() => {
    const byTyped = new Map<string, (typeof typos)[number]>();
    for (const t of typos) {
      const key = t.typed.toLowerCase();
      if (!byTyped.has(key)) byTyped.set(key, t);
    }
    return [...byTyped.values()];
  }, [typos]);

  if (!set || (groups.length === 0 && typoGroups.length === 0)) return null;

  const shown = groups.slice(0, MAX_SHOWN);
  const shownTypos = typoGroups.slice(0, MAX_SHOWN);

  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
      {groups.length > 0 && (
        <>
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
        </>
      )}

      {typoGroups.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            Did you mean?
          </div>
          <div className="flex flex-wrap gap-1.5">
            {shownTypos.map((t) => (
              <button
                key={t.typed.toLowerCase()}
                type="button"
                onClick={() => onChange(applyMatches(value, [{ ...t, text: t.typed }]))}
                aria-label={`Correct "${t.typed}" to "${t.entry.word}" and abbreviate to "${t.entry.abbr}"`}
                title={`"${t.typed}" looks like "${t.entry.word}" → ${t.entry.abbr}`}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-secondary/40"
              >
                <span className="text-muted-foreground line-through decoration-muted-foreground/40">{t.typed}</span>
                <span aria-hidden>→</span>
                <span className="font-medium">{t.entry.abbr}</span>
              </button>
            ))}
            {typoGroups.length > MAX_SHOWN && (
              <span className="self-center text-xs text-muted-foreground">+{typoGroups.length - MAX_SHOWN} more</span>
            )}
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {set.label} ({set.authority}). Use abbreviations only where they&apos;re clearly understood.
      </p>
    </div>
  );
}
