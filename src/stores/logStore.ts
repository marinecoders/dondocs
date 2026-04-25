import { create } from 'zustand';

export interface LogEntry {
  id: number;
  timestamp: Date;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: unknown;
}

interface LogState {
  logs: LogEntry[];
  isEnabled: boolean;
  isOpen: boolean;
  maxLogs: number;

  // Actions
  addLog: (level: LogEntry['level'], message: string, data?: unknown) => void;
  addLogDirect: (level: LogEntry['level'], message: string, data?: unknown) => void; // Bypasses isEnabled check
  clearLogs: () => void;
  setEnabled: (enabled: boolean) => void;
  setOpen: (open: boolean) => void;
}

let logId = 0;

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  isEnabled: true, // Enabled by default for debugging
  isOpen: false,
  maxLogs: 500,

  addLog: (level, message, data) => {
    if (!get().isEnabled) return;

    const entry: LogEntry = {
      id: logId++,
      timestamp: new Date(),
      level,
      message,
      data,
    };

    set((state) => ({
      logs: [...state.logs.slice(-(state.maxLogs - 1)), entry],
    }));
  },

  // Add log entry directly, bypassing the isEnabled check
  // Use this for critical errors that should always be captured
  addLogDirect: (level, message, data) => {
    const entry: LogEntry = {
      id: logId++,
      timestamp: new Date(),
      level,
      message,
      data,
    };

    set((state) => ({
      logs: [...state.logs.slice(-(state.maxLogs - 1)), entry],
    }));
  },

  clearLogs: () => set({ logs: [] }),

  setEnabled: (enabled) => set({ isEnabled: enabled }),

  setOpen: (open) => set({ isOpen: open }),
}));

// Intercept console methods when logging is enabled
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
  debug: typeof console.debug;
} | null = null;

/**
 * Whether the in-app log viewer should capture console.* calls.
 *
 * Capture is expensive in two ways: every console.log goes through
 * formatArg (which JSON.stringify's objects), then through a Zustand
 * `set()` that triggers re-renders for any subscriber, then buffers
 * up to 500 entries forever. In production for users who never open
 * the LogViewer, this is pure overhead — we throw the work away.
 *
 * Match the same gating as `debug.ts`: capture only when the user
 * has opted into debug mode via URL param, persistent localStorage
 * flag, or dev-mode default.
 */
function isDebugEnabled(): boolean {
  // 1. URL param (session-scoped opt-in)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const p = urlParams.get('debug');
    if (p === '1' || p === '2' || p === 'true') return true;
  }
  // 2. localStorage (persistent opt-in)
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('DONDOCS_DEBUG');
    if (stored === '1' || stored === '2' || stored === 'true') return true;
  }
  // 3. Dev mode default
  if (import.meta.env.DEV) return true;
  return false;
}

export function enableConsoleCapture() {
  if (originalConsole) return; // Already capturing
  // Production users who haven't opted into debug pay nothing — no
  // wrapper, no formatArg, no Zustand set, no buffer growth. They
  // also don't get to see anything in LogViewerModal, but that modal
  // is debug-only (it's hidden behind Help → View Logs which itself
  // requires debug mode to be on).
  if (!isDebugEnabled()) return;

  originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const store = useLogStore.getState();

  console.log = (...args) => {
    originalConsole?.log(...args);
    store.addLog('log', args.map(a => formatArg(a)).join(' '));
  };

  console.warn = (...args) => {
    originalConsole?.warn(...args);
    store.addLog('warn', args.map(a => formatArg(a)).join(' '));
  };

  console.error = (...args) => {
    originalConsole?.error(...args);
    store.addLog('error', args.map(a => formatArg(a)).join(' '));
  };

  console.info = (...args) => {
    originalConsole?.info(...args);
    store.addLog('info', args.map(a => formatArg(a)).join(' '));
  };

  console.debug = (...args) => {
    originalConsole?.debug(...args);
    store.addLog('debug', args.map(a => formatArg(a)).join(' '));
  };
}

export function disableConsoleCapture() {
  if (!originalConsole) return;

  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;

  originalConsole = null;
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}
