/** The exact printed designators normalized by the Word body projection.
 * Serialized formatting markers and visible UTF-16 offsets are distinct. */
export function readWordPrintedCounter(text: string): { serializedLength: number; visibleLength: number; level: number } | undefined {
  const underlined = /^\s*(?:__(\d+)__\.\s+|__([a-z])__\.\s+|\(__([0-9]+)__\)\s+|\(__([a-z])__\)\s+|__\((\d+)\)__\s+|__\(([a-z])\)__\s+)/.exec(text);
  if (underlined) return {
    serializedLength: underlined[0].length,
    visibleLength: underlined[0].replace(/__/g, '').length,
    level: underlined[1] ? 4 : underlined[2] ? 5 : underlined[3] || underlined[5] ? 6 : 7,
  };
  const plain = /^(\s*)(?:(\d+)\.\s+|([a-z])\.\s+|\((\d+)\)\s+|\(([a-z])\)\s+)/.exec(text);
  if (plain) return { serializedLength: plain[0].length, visibleLength: plain[0].length, level: plain[2] ? 0 : plain[3] ? 1 : plain[4] ? 2 : 3 };
}
