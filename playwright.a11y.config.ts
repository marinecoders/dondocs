import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const port = process.env.DONDOCS_A11Y_PORT ?? '4173';
const baseURL = `http://127.0.0.1:${port}`;

// Focused gate: do not multiply full-page scans across the normal browser matrix.
export default defineConfig({
  ...base,
  testMatch: 'accessibility.spec.ts',
  timeout: 90_000,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { ...base.use, baseURL, reducedMotion: 'reduce', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium' } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
