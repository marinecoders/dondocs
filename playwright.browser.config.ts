import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Keep application browser checks independent of the two-build upgrade harness.
export default defineConfig({
  ...base,
  testMatch: ['install.spec.ts', 'downloads.spec.ts', 'settings-navigation.spec.ts', 'preview-zoom.spec.ts', 'document-lifecycle.spec.ts'],
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173', reducedMotion: 'reduce' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'msedge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
    // iPadOS can send a desktop Mac UA while retaining touch support.
    { name: 'ipad-safari', use: { ...devices['iPad Pro 11'], userAgent: devices['Desktop Safari'].userAgent } },
    {
      name: 'mobile-chrome-ios',
      use: {
        ...devices['iPhone 13'],
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.83 Mobile/15E148 Safari/604.1',
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
