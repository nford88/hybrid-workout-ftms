import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: !process.env.HEADED,
    launchOptions: {
      slowMo: process.env.HEADED ? 600 : 0,
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 10000,
  },
})
