/** Error and diagnostic properties come from external engines and may themselves throw. */
export function exportErrorMessage(error: unknown): string {
  try { return String(error instanceof Error ? error.message : error); }
  catch { return 'The export failed.'; }
}

export function exportCompileLog(error: unknown): string | undefined {
  try {
    if (!(error instanceof Error)) return undefined;
    const value: unknown = Reflect.get(error, 'compileLog');
    return typeof value === 'string' ? value : undefined;
  } catch { return undefined; }
}
