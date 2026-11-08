let active = 0;
export function isFileImportInProgress(): boolean { return active > 0; }

/** Include file reads and the resulting document changes in the update barrier. */
export async function runFileImport<T>(readAndApply: () => Promise<T>): Promise<T> {
  active++;
  try { return await readAndApply(); } finally { active--; }
}
