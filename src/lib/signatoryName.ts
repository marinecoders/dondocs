/**
 * The abbreviated signatory form used wherever a document is signed over a
 * typed name: initials + SURNAME ("R. L. SMITH"), no rank or title.
 *
 * One definition, because it already grew two divergent copies — the appended
 * endorsement's signer and the AA form's originator — and the second copy
 * reintroduced a fixed bug (a middle initial sliding into the first slot when
 * first is blank). Pure and leaf so every signer, whatever the store or form,
 * abbreviates identically.
 *
 * (The letter's full signature block is a different convention — capitalized
 * full names via the LaTeX generator — and deliberately not this function.)
 */
export function abbreviatedSignatoryName(
  firstName?: string,
  middleName?: string,
  lastName?: string
): string {
  // First and middle are positional: a middle initial without a first must not
  // slide into the first slot and print "A. DOE" for someone who left first
  // blank. Drop the middle when there is no first.
  const first = (firstName || '').trim().charAt(0).toUpperCase();
  const middle = first ? (middleName || '').trim().charAt(0).toUpperCase() : '';
  const initials = [first, middle]
    .filter(Boolean)
    .map((initial) => `${initial}.`)
    .join(' ');
  const last = (lastName || '').trim().toUpperCase();
  return [initials, last].filter(Boolean).join(' ');
}
