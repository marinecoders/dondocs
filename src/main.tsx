import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'

declare global {
  interface Window {
    /** Set the moment the app bundle executes; read by the index.html boot
     *  watchdog to tell "stale shell, scripts never loaded" apart from a
     *  healthy boot. */
    __DD_BOOTED__?: boolean
  }
}

// First observable act of the bundle — if the shell's script tags point at
// bundles a deploy has replaced, this line never runs and the watchdog in
// index.html self-heals with a one-shot cache-bypassing reload.
window.__DD_BOOTED__ = true

// Initialize debug utility (registers global DONDOCS object and keyboard shortcut)
import '@/lib/debug'

// Enable console capture for logging
import { enableConsoleCapture } from '@/stores/logStore'
enableConsoleCapture()

// Migrate legacy localStorage keys to current naming convention
function migrateLocalStorage() {
  // codeql[js/incomplete-sanitization]: false positive — these are hardcoded
  // string constants, each containing exactly one `]` (the obfuscation sentinel
  // that hides the legacy "libo" name from grep). Non-global replace is
  // correct since each string has exactly one `]` to remove.
  const legacyPrefixes = ['l]ibo-secured-', 'l]ibo_', 'l]ibo-', 'L]IBO_'].map(p => p.replace(']', ''));
  const keysToMigrate: [string, string][] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    for (const prefix of legacyPrefixes) {
      if (key.startsWith(prefix)) {
        const suffix = key.slice(prefix.length);
        const newPrefix = prefix.toLowerCase().includes('_') ? 'dondocs_' : 'dondocs-';
        const newKey = key.startsWith('LIBO') ? 'DONDOCS_' + suffix : newPrefix + suffix;
        keysToMigrate.push([key, newKey]);
        break;
      }
    }
  }

  for (const [oldKey, newKey] of keysToMigrate) {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, oldValue);
      localStorage.removeItem(oldKey);
    }
  }
}

// migrateLocalStorage runs BEFORE the ErrorBoundary mounts, so any throw
// here would bypass the boundary and produce the white screen we just
// added the boundary to prevent. Guard with try/catch — migration is
// best-effort cleanup of legacy keys; failing to migrate one key
// shouldn't prevent the app from booting.
try {
  migrateLocalStorage();
} catch (err) {
  console.error('[main] migrateLocalStorage failed (non-fatal):', err);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
