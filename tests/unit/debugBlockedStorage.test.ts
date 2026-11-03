import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('debug settings when browser storage is unavailable', () => {
  it.each(['getter', 'methods'] as const)('does not block startup when the storage %s throws', async (failure) => {
    if (failure === 'getter') {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Site data blocked', 'SecurityError'); },
      });
    } else {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new DOMException('Site data blocked', 'SecurityError');
      });
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('Site data blocked', 'SecurityError');
      });
    }
    const { debug } = await import('@/lib/debug');
    const { enableConsoleCapture, disableConsoleCapture } = await import('@/stores/logStore');
    try {
      expect(() => enableConsoleCapture()).not.toThrow();
      expect(() => debug.level(0)).not.toThrow();
    } finally {
      disableConsoleCapture();
    }
  });
});
