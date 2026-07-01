/**
 * Shared "hard-required field is unfilled" predicate. Kept in a leaf module (no
 * imports) so both the section registry (editorSections, which computes the rail
 * dots / readiness meter) and the individual section components (which flag the
 * exact same field with an aria-invalid ring) can use it without a circular
 * import through editorSections.
 *
 * A field counts as unfilled when it's empty or still a bracketed placeholder
 * like [SUBJECT]; the two views stay in lockstep by sharing this one rule.
 */
export const unfilled = (v?: string): boolean => {
  const t = (v ?? '').trim();
  return !t || /^\[.*\]$/.test(t);
};
