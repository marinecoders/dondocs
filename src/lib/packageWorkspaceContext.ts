/** Navigation convenience only: package content remains owned by saved records. */
export const PACKAGE_WORKSPACE_CONTEXT_KEY = 'dondocs-package-workspace';
export const packageWorkspaceSections = ['overview', 'documents', 'review', 'delivery'] as const;
export type PackageWorkspaceSection = typeof packageWorkspaceSections[number];
export interface PackageWorkspaceContext {
  version: 1;
  packageId: string;
  revisionId: string;
  memberId: string | null;
  section: PackageWorkspaceSection;
}
const identity = /^[a-zA-Z0-9_-]{1,100}$/;

function valid(value: unknown): value is PackageWorkspaceContext {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PackageWorkspaceContext>;
  const keys = Object.keys(record);
  return keys.length === 5 && keys.every(key => ['version', 'packageId', 'revisionId', 'memberId', 'section'].includes(key))
    && record.version === 1 && typeof record.packageId === 'string' && identity.test(record.packageId)
    && typeof record.revisionId === 'string' && identity.test(record.revisionId)
    && (record.memberId === null || typeof record.memberId === 'string' && identity.test(record.memberId))
    && packageWorkspaceSections.includes(record.section as PackageWorkspaceSection);
}

export function readPackageWorkspaceContext(): PackageWorkspaceContext | null {
  try {
    const raw = localStorage.getItem(PACKAGE_WORKSPACE_CONTEXT_KEY);
    if (!raw || raw.length > 512) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch { return null; }
}

/** A blocked preference write never prevents editing or implies a package save. */
export function rememberPackageWorkspaceContext(value: PackageWorkspaceContext): void {
  if (!valid(value)) return;
  try { localStorage.setItem(PACKAGE_WORKSPACE_CONTEXT_KEY, JSON.stringify(value)); }
  catch { /* Navigation restoration is best effort, separate from content durability. */ }
}

// Only reload the workspace in the tab that had it open. A deliberate close or
// return to the library clears the route while keeping the cross-tab history.
export function activePackageWorkspace(): PackageWorkspaceContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PACKAGE_WORKSPACE_CONTEXT_KEY) ?? 'null') as unknown;
    return valid(value) ? value : null;
  } catch { return null; }
}

export function setActivePackageWorkspace(value: PackageWorkspaceContext | null) {
  try {
    if (value) sessionStorage.setItem(PACKAGE_WORKSPACE_CONTEXT_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY);
  } catch { /* Navigation storage can be blocked. */ }
}

export const packageSectionLabels: Record<PackageWorkspaceSection, string> = {
  overview: 'Overview', documents: 'Documents', review: 'Review', delivery: 'Delivery',
};
