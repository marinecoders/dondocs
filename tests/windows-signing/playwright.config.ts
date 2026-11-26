import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'workspace.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 25_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178', serviceWorkers: 'block' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4178 --strictPort',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:4178/',
    reuseExistingServer: false,
  },
});
