/**
 * Suggest where a NAVMC 10274 action routes ("7. To") from its free-text
 * "Nature of Action" (field 8). Keyword-matches against the advisory routing
 * map and returns the candidate routes, best (most keyword hits) first.
 *
 * Matching is whole-word / whole-phrase (word boundaries) so short triggers
 * like "eas" or "pay" don't fire inside "please" or "display". Pure and leaf —
 * the suggestion UI confirms with the drafter; this never decides on its own.
 */

import { ACTION_ROUTING, type ActionRoute } from '@/data/actionRouting';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `keyword` appears as a whole word / phrase in `text` (lowercased). */
function hasKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i').test(text);
}

/**
 * Routes whose keywords appear in `natureText`, most-matched first. Empty when
 * the text is blank or nothing matches — the UI then just offers the picker.
 */
export function suggestRouting(natureText: string): ActionRoute[] {
  const text = (natureText || '').toLowerCase();
  if (!text.trim()) return [];

  return ACTION_ROUTING.map((route) => ({
    route,
    hits: route.keywords.reduce((n, kw) => n + (hasKeyword(text, kw) ? 1 : 0), 0),
  }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.route);
}
