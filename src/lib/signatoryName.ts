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

const FAMILY_NAME_PARTICLES = new Set([
  'da', 'de', 'del', 'della', 'den', 'der', 'di', 'dos', 'du', 'la', 'le', 'van', 'von',
]);

/** MOA/MOU share initials, common family-name particles and generational suffixes
 * across PDF, Word, and digital field lookup. A single field cannot infer every
 * name convention; explicitly entered initials are retained. */
export function abbreviatedFullSignatoryName(name?: string): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const suffix = parts.length > 1 && /^(?:Jr\.?|Sr\.?|II|III|IV)$/i.test(parts.at(-1)!)
    ? parts.pop()!.toUpperCase() : undefined;
  let familyStart = Math.max(0, parts.length - 1);
  while (familyStart > 1 && FAMILY_NAME_PARTICLES.has(parts[familyStart - 1].toLowerCase())) familyStart--;
  const surname = parts.slice(familyStart).join(' ').toUpperCase();
  const initials = parts.slice(0, familyStart).flatMap(part => {
    const letters = /^\p{L}(?:\.\p{L})*\.?$/u.test(part)
      ? part.replace(/\.$/, '').split('.')
      : [Array.from(part)[0]];
    return letters.map(letter => `${letter.toUpperCase()}.`);
  });
  return [...initials, surname, suffix].filter(Boolean).join(' ');
}
