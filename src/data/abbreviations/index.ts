/**
 * Per-order abbreviation sets. Today one set — the IRAM recordkeeping
 * abbreviations (MCO P1070.12K ch. 6) — bound to the recordkeeping forms it
 * governs (Page 11 / NAVMC 118(11) and the AA form / NAVMC 10274). The registry
 * shape lets other orders add their own sets later, and the active set is chosen
 * by the document/form in view (issue #25).
 *
 * The dataset (~1,600 entries) is loaded on demand so it never weighs down the
 * initial bundle — only a drafter on a recordkeeping form pulls it in.
 */

export interface AbbrevEntry {
  /** The full word or phrase, as written in the IRAM (e.g. "commanding officer"). */
  word: string;
  /** The authorized abbreviation (e.g. "CO"). */
  abbr: string;
  /** Usable only inside a compound abbreviation (IRAM ¶6001.2) — never alone. */
  compoundOnly?: boolean;
}

export interface AbbrevSet {
  id: string;
  /** Short human label for the source. */
  label: string;
  /** Governing publication, for the "why" note. */
  authority: string;
  /** Lazy-load the entries (the data chunk is fetched on first use). */
  load: () => Promise<AbbrevEntry[]>;
}

export const ABBREVIATION_SETS: Record<string, AbbrevSet> = {
  iram: {
    id: 'iram',
    label: 'IRAM recordkeeping abbreviations',
    authority: 'MCO P1070.12K, ch. 6',
    load: async () => {
      const mod = await import('./iram.generated.json');
      return (mod.default.entries ?? mod.default) as AbbrevEntry[];
    },
  },
};

/**
 * The abbreviation set that applies to a form, or null. The IRAM set governs the
 * recordkeeping forms; correspondence (naval letters) follows SECNAV M-5216.5's
 * different "spell it out first" rule and is intentionally left out for now.
 */
export function abbrevSetForForm(formType: string | undefined): AbbrevSet | null {
  if (formType === 'navmc_10274' || formType === 'navmc_11811') return ABBREVIATION_SETS.iram;
  return null;
}
