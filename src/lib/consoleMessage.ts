function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
}

/** Plain-text counterpart of browser console formatting; CSS styles are omitted. */
export function formatConsoleMessage(args: unknown[]): string {
  if (typeof args[0] !== 'string' || args.length < 2) return args.map(formatValue).join(' ');
  let next = 1;
  const message = args[0].replace(/%[%csdifoO]/g, (specifier) => {
    if (specifier === '%%') return '%';
    if (next >= args.length) return specifier;
    const value = args[next++];
    if (specifier === '%c') return '';
    if (specifier === '%s') return String(value);
    if (specifier === '%d' || specifier === '%i' || specifier === '%f') {
      try {
        return String(specifier === '%f' ? Number.parseFloat(String(value)) : Number.parseInt(String(value), 10));
      } catch { return formatValue(value); }
    }
    return formatValue(value);
  });
  return [message, ...args.slice(next).map(formatValue)].join(' ');
}
