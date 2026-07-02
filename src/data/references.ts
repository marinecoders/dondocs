/**
 * Reference library — single source of truth.
 *
 * Backed by `references.json` (rich schema: stable ids, type/number/title,
 * short titles, keywords, functional categories). Replaces the two hardcoded
 * inline arrays that used to live in ReferenceLibraryModal and
 * FormReferenceLibraryModal. Mirrors the data-module pattern of
 * `officeCodes.ts` / `unitDirectory.ts` (JSON data + typed accessors).
 */
import referencesData from './references.json';

export interface Reference {
  /** Stable id, e.g. `mco-1610-7`. Lets saved data reference a directive by
   *  id instead of a free-text string (future auto-update-on-reissue work). */
  id: string;
  /** Issuing authority / series, e.g. `MCO`, `SECNAV M`, `UCMJ`, `Manual`. */
  type: string;
  /** Order/article number, e.g. `1610.7A`. Empty for the correspondence
   *  quick-insert pseudo-entries (Reference (a), Endorsement 1, …). */
  number: string;
  title: string;
  /** Optional colloquial name, e.g. `FITREP/PRO-CON Order`. Searchable. */
  shortTitle?: string;
  category: string;
  keywords: string[];
}

interface ReferencesFile {
  version: string;
  lastUpdated: string;
  categories: string[];
  references: Reference[];
}

const data = referencesData as ReferencesFile;

/** Canonical category order (drives grouping in the picker). */
export const REFERENCE_CATEGORIES: readonly string[] = data.categories;

export const ALL_REFERENCES: readonly Reference[] = data.references;

/**
 * Human-readable citation, e.g. `MCO 1610.7A - Performance Evaluation System`.
 * `Manual`-type entries (UCMJ, MCM, JAGMAN) lead with the acronym; the
 * correspondence quick-inserts (no number) render as their title alone.
 */
export function formatReference(ref: Reference): string {
  if (!ref.number) return ref.title;
  let head: string;
  if (ref.type === 'Manual') {
    head = ref.number; // UCMJ, MCM, JAGMAN — the number IS the acronym
  } else if (ref.type === 'SECNAV M') {
    head = `SECNAV M-${ref.number}`; // cited with a hyphen: SECNAV M-5216.5
  } else {
    head = `${ref.type} ${ref.number}`;
  }
  return ref.title ? `${head} - ${ref.title}` : head;
}

export function getReference(id: string): Reference | undefined {
  return ALL_REFERENCES.find((r) => r.id === id);
}

/**
 * Keyword-aware search. Every whitespace-separated token in the query must
 * appear somewhere in the entry's searchable text (citation, type, number,
 * title, short title, category, or keywords) — so `fitness report` matches
 * the FITREP order via its keywords, not just a title substring. An empty
 * query returns everything.
 */
export function searchReferences(query: string): Reference[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...ALL_REFERENCES];
  return ALL_REFERENCES.filter((r) => {
    const haystack = [
      formatReference(r),
      r.type,
      r.number,
      r.title,
      r.shortTitle ?? '',
      r.category,
      ...r.keywords,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

/**
 * Group references by category in canonical order, dropping empty categories.
 * Pass the result of `searchReferences` to render filtered results grouped.
 */
export function getReferencesByCategory(
  refs: readonly Reference[] = ALL_REFERENCES,
): Record<string, Reference[]> {
  const grouped: Record<string, Reference[]> = {};
  for (const cat of REFERENCE_CATEGORIES) grouped[cat] = [];
  for (const r of refs) {
    (grouped[r.category] ??= []).push(r);
  }
  for (const cat of Object.keys(grouped)) {
    if (grouped[cat].length === 0) delete grouped[cat];
  }
  return grouped;
}
