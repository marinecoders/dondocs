/** Stable object ordering binds exactly the captured portable payload, including its bytes. */
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  const canonical = (item: unknown, depth = 0): unknown => {
    if (++nodes > 100_000 || depth > 50) throw new Error('The document data is too complex.');
    if (Array.isArray(item)) return item.map(child => canonical(child, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child, depth + 1)]));
    if (typeof item === 'number' && !Number.isFinite(item) || ['bigint', 'function', 'symbol'].includes(typeof item)) throw new Error('Invalid document data.');
    return item;
  };
  const encoded = JSON.stringify(canonical(value));
  if (typeof encoded !== 'string') throw new Error('Invalid document data.');
  return encoded;
}
