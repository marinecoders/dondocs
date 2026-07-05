/**
 * The red asterisk that marks a required field. One shared marker so every form
 * uses the same convention (a bare " *") instead of a mix of "*" and
 * "* Required". The required state is also conveyed to assistive tech by the
 * field's own aria-invalid / required attributes; this glyph is the visual cue.
 */
export function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      {' '}*
    </span>
  );
}
