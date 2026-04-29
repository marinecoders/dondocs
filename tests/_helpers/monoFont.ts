/**
 * A fake monospace font that mirrors `pdf-lib`'s `widthOfTextAtSize` API.
 * Every character is 1 unit wide regardless of size, so wrapping tests can
 * specify `maxWidth` in characters and reason deterministically about
 * line breaks without pulling in pdf-lib (which is large, async to load,
 * and not the system under test here).
 *
 * Used by `tests/unit/textWrap.*.test.ts` and the regression corpus.
 */
export interface FontLike {
  widthOfTextAtSize(text: string, size: number): number;
}

export const monoFont: FontLike = {
  widthOfTextAtSize(text: string, _size: number) {
    return text.length;
  },
};
