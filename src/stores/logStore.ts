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

export function enableConsoleCapture() {
  if (originalConsole) return; // Already capturing

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
