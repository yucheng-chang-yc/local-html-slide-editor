import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.WEB_E2E_BASE_URL ?? 'http://127.0.0.1:4387';
const serverPort = new URL(baseURL).port || '4387';

export default defineConfig({
  testDir: './tests/web-e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence/web-browser/test-results.json' }], ['html', { outputFolder: 'evidence/web-browser/playwright-report', open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: `pnpm exec vite preview --mode browser --host 127.0.0.1 --port ${serverPort}`, url: baseURL, reuseExistingServer: true, timeout: 60_000 },
});
