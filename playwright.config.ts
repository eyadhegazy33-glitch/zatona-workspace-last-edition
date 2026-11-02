import { defineConfig } from '@playwright/test';

const isStaging = process.env.E2E_ENV === 'staging';
const baseURL = process.env.E2E_BASE_URL ?? '';
const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(baseURL);

if (process.env.E2E_ENV && !isStaging) {
  throw new Error('E2E_ENV must be "staging"; E2E tests are never allowed against production.');
}

if (isStaging && !baseURL) {
  throw new Error('Set E2E_BASE_URL to the staging application URL.');
}

if (isStaging && isLocalTarget &&
    (!process.env.E2E_SUPABASE_URL || !process.env.E2E_SUPABASE_ANON_KEY)) {
  throw new Error('Local staging E2E runs require E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY.');
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    baseURL: baseURL || 'http://localhost:5173',
    trace: 'off',
  },
  ...(isStaging && isLocalTarget ? {
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1',
      url: baseURL,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL!,
        VITE_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY!,
      },
    },
  } : {}),
});
