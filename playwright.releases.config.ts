import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, testMatch: ['releases.spec.ts', 'release-offline-spelling.spec.ts', 'word-offline.spec.ts'], timeout: 180000 });
