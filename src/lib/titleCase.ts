const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet']);

/** Raise ordinary words without guessing how to recase acronyms or names. */
export function toTitleCase(text: string): string {
  let index = 0;
  return text.replace(/\S+/g, word => {
    const first = index++ === 0;
    const tail = word.slice(1);
    if (tail !== tail.toLowerCase()) return word;
    if (!first && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + tail;
  });
}
