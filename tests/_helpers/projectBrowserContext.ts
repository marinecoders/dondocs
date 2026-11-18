import type { BrowserContextOptions, TestInfo } from '@playwright/test';

/** Keep independent recipients on the same device path as their owner browser. */
export function projectBrowserContextOptions(info: TestInfo): BrowserContextOptions {
  const { userAgent, isMobile, hasTouch, deviceScaleFactor, reducedMotion } = info.project.use;
  return { userAgent, isMobile, hasTouch, deviceScaleFactor, reducedMotion };
}
