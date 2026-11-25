// Tab-scoped navigation only. Answers live in the package and its IndexedDB recovery draft.
export function readFormLocation(key: string): string {
  try { return sessionStorage.getItem('dondocs-package-form/' + key) ?? ''; }
  catch { return ''; }
}

export function rememberFormLocation(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem('dondocs-package-form/' + key, value);
    else sessionStorage.removeItem('dondocs-package-form/' + key);
  } catch { /* Editing still works when navigation storage is unavailable. */ }
}
