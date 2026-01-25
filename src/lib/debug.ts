/**
 * Debug Utility for DONDOCS-SECURED
 *
 * Easy access methods:
 * - Keyboard: Ctrl+Shift+D to toggle debug mode
 * - Console: DONDOCS.debug.enable() / DONDOCS.debug.disable() / DONDOCS.debug.status()
 * - URL: Add ?debug=true to enable for session
 * - Persistent: localStorage.setItem('DONDOCS_DEBUG', 'true')
 *
 * Usage in code:
 *   import { debug } from '@/lib/debug';
 *   debug.log('Component', 'message', data);
 *   debug.warn('Component', 'warning message');
 *   debug.error('Component', 'error message', error);
 *   debug.time('Operation');
 *   debug.timeEnd('Operation');
 */

type LogLevel = 'log' | 'warn' | 'error' | 'info';

interface DebugConfig {
  enabled: boolean;
  categories: Set<string>;
  showTimestamps: boolean;
  showPerformance: boolean;
}

// Check various sources for debug flag
function getInitialDebugState(): boolean {
  // 1. Check URL param (highest priority for session)
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === 'true') {
      return true;
    }
  }

  // 2. Check localStorage (persistent)
  if (typeof localStorage !== 'undefined') {
    if (localStorage.getItem('DONDOCS_DEBUG') === 'true') {
      return true;
    }
  }

  // 3. Check if in development mode
  if (import.meta.env.DEV) {
    return true;
  }

  return false;
}

const config: DebugConfig = {
  enabled: getInitialDebugState(),
  categories: new Set<string>(), // Empty = all categories enabled
  showTimestamps: true,
  showPerformance: true,
};

// Performance tracking
const timers: Map<string, number> = new Map();
const metrics: Map<string, number[]> = new Map();

// Styled console output
const styles = {
  log: 'color: #6b7280; font-weight: normal;',
  info: 'color: #3b82f6; font-weight: normal;',
  warn: 'color: #f59e0b; font-weight: bold;',
  error: 'color: #ef4444; font-weight: bold;',
  category: 'color: #8b5cf6; font-weight: bold;',
  timestamp: 'color: #9ca3af; font-size: 10px;',
  performance: 'color: #10b981; font-style: italic;',
};

function formatMessage(level: LogLevel, category: string, message: string): string[] {
  const parts: string[] = [];
  const stylesParts: string[] = [];

  if (config.showTimestamps) {
    const time = new Date().toISOString().slice(11, 23);
    parts.push(`%c[${time}]`);
    stylesParts.push(styles.timestamp);
  }

  parts.push(`%c[${category}]`);
  stylesParts.push(styles.category);

  parts.push(`%c${message}`);
  stylesParts.push(styles[level]);

  return [parts.join(' '), ...stylesParts];
}

function shouldLog(category: string): boolean {
  if (!config.enabled) return false;
  if (config.categories.size === 0) return true; // All categories enabled
  return config.categories.has(category);
}

export const debug = {
  // Core logging methods
  log(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('log', category, message);
    console.log(formatted, ...logStyles, ...data);
  },

  info(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('info', category, message);
    console.info(formatted, ...logStyles, ...data);
  },

  warn(category: string, message: string, ...data: unknown[]): void {
    if (!shouldLog(category)) return;
    const [formatted, ...logStyles] = formatMessage('warn', category, message);
    console.warn(formatted, ...logStyles, ...data);
  },

  error(category: string, message: string, ...data: unknown[]): void {
    // Always log errors, even if debug is disabled
    const [formatted, ...logStyles] = formatMessage('error', category, message);
    console.error(formatted, ...logStyles, ...data);
  },

  // Performance timing
  time(label: string): void {
    if (!config.enabled || !config.showPerformance) return;
    timers.set(label, performance.now());
  },

  timeEnd(label: string): number {
    const start = timers.get(label);
    if (!start) {
      if (config.enabled) {
        console.warn(`Timer '${label}' does not exist`);
      }
      return 0;
    }

    const duration = performance.now() - start;
    timers.delete(label);

    // Track metrics
    if (!metrics.has(label)) {
      metrics.set(label, []);
    }
    metrics.get(label)!.push(duration);

    if (config.enabled && config.showPerformance) {
      console.log(
        `%c⏱ ${label}: ${duration.toFixed(2)}ms`,
        styles.performance
      );
    }

    return duration;
  },

  // Group logging
  group(category: string, label: string): void {
    if (!shouldLog(category)) return;
    console.group(`%c[${category}] ${label}`, styles.category);
  },

  groupEnd(): void {
    if (!config.enabled) return;
    console.groupEnd();
  },

  // Table logging for data
  table(category: string, data: unknown): void {
    if (!shouldLog(category)) return;
    console.log(`%c[${category}] Data:`, styles.category);
    console.table(data);
  },

  // State inspection
  inspect(category: string, label: string, obj: unknown): void {
    if (!shouldLog(category)) return;
    console.log(`%c[${category}] ${label}:`, styles.category);
    console.dir(obj, { depth: 4 });
  },

  // Configuration methods
  enable(): void {
    config.enabled = true;
    localStorage.setItem('DONDOCS_DEBUG', 'true');
    console.log('%c🔧 DONDOCS Debug Mode ENABLED', 'color: #10b981; font-weight: bold; font-size: 14px;');
    console.log('Use DONDOCS.debug.help() for available commands');
  },

  disable(): void {
    config.enabled = false;
    localStorage.removeItem('DONDOCS_DEBUG');
    console.log('%c🔧 DONDOCS Debug Mode DISABLED', 'color: #6b7280; font-weight: bold;');
  },

  toggle(): void {
    if (config.enabled) {
      debug.disable();
    } else {
      debug.enable();
    }
  },

  status(): void {
    console.log('%c📊 DONDOCS Debug Status', 'color: #8b5cf6; font-weight: bold; font-size: 14px;');
    console.table({
      enabled: config.enabled,
      categories: config.categories.size === 0 ? 'All' : [...config.categories].join(', '),
      showTimestamps: config.showTimestamps,
      showPerformance: config.showPerformance,
      environment: import.meta.env.DEV ? 'Development' : 'Production',
    });
  },

  // Filter by category
  only(...categories: string[]): void {
    config.categories = new Set(categories);
    console.log(`%c🔍 Filtering to categories: ${categories.join(', ')}`, styles.info);
  },

  all(): void {
    config.categories.clear();
    console.log('%c🔍 Showing all categories', styles.info);
  },

  // Performance metrics
  metrics(): void {
    console.log('%c📈 Performance Metrics', 'color: #10b981; font-weight: bold; font-size: 14px;');
    const metricsData: Record<string, { avg: string; min: string; max: string; count: number }> = {};

    metrics.forEach((times, label) => {
      if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        metricsData[label] = {
          avg: `${avg.toFixed(2)}ms`,
          min: `${min.toFixed(2)}ms`,
          max: `${max.toFixed(2)}ms`,
          count: times.length,
        };
      }
    });

    if (Object.keys(metricsData).length === 0) {
      console.log('No metrics recorded yet');
    } else {
      console.table(metricsData);
    }
  },

  clearMetrics(): void {
    metrics.clear();
    console.log('%c🗑 Metrics cleared', styles.info);
  },

  // Help
  help(): void {
    console.log(`
%c🔧 DONDOCS Debug Commands
%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

%cToggle Debug Mode:%c
  DONDOCS.debug.enable()     - Enable debug logging
  DONDOCS.debug.disable()    - Disable debug logging
  DONDOCS.debug.toggle()     - Toggle debug mode
  DONDOCS.debug.status()     - Show current status

%cFilter Categories:%c
  DONDOCS.debug.only('LaTeX', 'Store')  - Only show specific categories
  DONDOCS.debug.all()                    - Show all categories

%cPerformance:%c
  DONDOCS.debug.metrics()      - Show performance metrics
  DONDOCS.debug.clearMetrics() - Clear recorded metrics

%cKeyboard Shortcut:%c
  Ctrl+Shift+D - Toggle debug mode

%cURL Parameter:%c
  Add ?debug=true to URL to enable for session

%cCategories:%c
  LaTeX, Store, PDF, DOCX, UI, Engine, Compile, Error
`,
      'color: #8b5cf6; font-weight: bold; font-size: 16px;',
      'color: #6b7280;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;',
      'color: #3b82f6; font-weight: bold;', 'color: #9ca3af;'
    );
  },

  // Check if enabled (for conditional logic)
  get isEnabled(): boolean {
    return config.enabled;
  },
};

// TexLive debugging helpers
const texlive = {
  // Fetch summary from dev server (only works in development)
  async summary(): Promise<void> {
    try {
      const res = await fetch('/__texlive_summary');
      if (!res.ok) {
        console.log('%c[texlive] Summary only available in development mode', 'color: #f59e0b');
        return;
      }
      const data = await res.json();

      console.log('%c\n📦 TeX Live Request Summary', 'color: #10b981; font-weight: bold; font-size: 14px');
      console.log('%c────────────────────────────', 'color: #6b7280');

      console.log(`%c✓ Served: ${data.servedCount} files`, 'color: #10b981');
      console.log(`%c✗ Missing: ${data.missingCount} files`, 'color: #ef4444');

      if (data.missing.length > 0) {
        console.log('%c\nMissing files (returned 301):', 'color: #ef4444; font-weight: bold');
        data.missing.forEach((f: string) => console.log(`  - ${f}`));
        console.log('%c\nTo add missing files, copy them to public/lib/texlive/pdftex/<format>/', 'color: #6b7280');
      }

      if (data.served.length > 0) {
        console.groupCollapsed('%cServed files (click to expand)', 'color: #10b981');
        data.served.forEach((f: string) => console.log(`  ✓ ${f}`));
        console.groupEnd();
      }

      console.log('%c────────────────────────────\n', 'color: #6b7280');
    } catch (err) {
      console.error('[texlive] Failed to fetch summary:', err);
    }
  },

  // Show help
  help(): void {
    console.log(`
%c📦 TeX Live Debug Commands%c

  DONDOCS.texlive.summary()  - Show all requested files and which are missing
  DONDOCS.texlive.help()     - Show this help

%cVite Terminal shows real-time logs:%c
  ✓ 200  file → served     (file exists)
  ✗ 301  file → MISSING    (file not found, pdfTeX will fallback)
  ✓ STUB file → stub       (known stub file served)

%cFormat numbers:%c
  3  = tfm (font metrics)    26 = tex (source)
  4  = type1 (pfb fonts)     27 = sty (style)
  10 = cfg (config)          28 = cls (class)
  11 = map (font map)        32 = def (definitions)
  33 = vf (virtual font)     39 = clo (class options)
`,
      'color: #10b981; font-weight: bold; font-size: 14px',
      'color: inherit',
      'color: #f59e0b; font-weight: bold',
      'color: inherit',
      'color: #3b82f6; font-weight: bold',
      'color: inherit'
    );
  }
};

// Expose to window for console access
declare global {
  interface Window {
    DONDOCS: {
      debug: typeof debug;
      texlive: typeof texlive;
      version: string;
    };
  }
}

if (typeof window !== 'undefined') {
  window.DONDOCS = {
    debug,
    texlive,
    version: '1.0.0',
  };

  // Keyboard shortcut: Ctrl+Shift+D
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      debug.toggle();
    }
  });

  // Show startup message if debug is enabled
  if (config.enabled) {
    console.log(
      '%c🔧 DONDOCS Debug Mode Active %c(Ctrl+Shift+D to toggle)',
      'color: #10b981; font-weight: bold; font-size: 12px;',
      'color: #6b7280; font-size: 10px;'
    );
    console.log(
      '%c📦 TeX Live debugging: %cDONDOCS.texlive.help()',
      'color: #3b82f6; font-size: 11px;',
      'color: #6b7280; font-size: 11px;'
    );
  }
}

export default debug;
