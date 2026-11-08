export const RUNTIME_BASE = (typeof __RUNTIME_BASE__ === 'string' && __RUNTIME_BASE__) || import.meta.env?.BASE_URL || '/';

/** Saved immutable form revisions retain their existing, release-independent URLs. */
export function formAssetUrl(directory: string, file: string): string {
  const base = /\/revisions\/[a-f0-9]+$/.test(directory) ? '/' : import.meta.env?.BASE_URL || '/';
  return `${base}templates/${directory.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(file)}`;
}
