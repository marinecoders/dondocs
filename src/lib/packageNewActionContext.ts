const KEY = 'dondocs-package-new-action';
export interface PackageNewActionContext { source: 'maintained' | 'library'; id: string; revision: string }
export function readPackageNewActionContext(): PackageNewActionContext | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 1024) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as PackageNewActionContext;
    return Object.keys(candidate).length === 3 && ['maintained', 'library'].includes(candidate.source)
      && typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 100
      && typeof candidate.revision === 'string' && candidate.revision.length > 0 && candidate.revision.length <= 100 ? candidate : null;
  } catch { return null; }
}
/** Navigation hint only. Answers and file bytes remain in the version-scoped IndexedDB draft. */
export function rememberPackageNewActionContext(value: PackageNewActionContext): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* The saved draft remains available from its starter. */ }
}
export function clearPackageNewActionContext(expected: PackageNewActionContext): void {
  const current = readPackageNewActionContext();
  if (!current || current.source !== expected.source || current.id !== expected.id || current.revision !== expected.revision) return;
  try { localStorage.removeItem(KEY); } catch { /* A stale navigation hint cannot modify package content. */ }
}
