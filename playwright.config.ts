import { defineConfig } from '@playwright/test';

const externallyManagedServer = process.env.E2E_EXTERNAL_SERVER === '1';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4187';
const serverPort = new URL(baseURL).port || '4187';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'evidence/test-results/e2e-results.json' }],
    ['html', { open: 'never' }],
  ],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { viewport: { width: 1440, height: 1000 } } }],
  webServer: externallyManagedServer ? undefined : {
    command: 'node dist/server/apps/server/index.js',
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
    timeout: 60_000,
    env: { PORT: serverPort },
  },
});
