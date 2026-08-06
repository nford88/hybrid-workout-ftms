import { defineConfig } from '@playwright/test'

/**
 * Port 3000 is contended on this machine: an unrelated `next-server` binds `*:3000` while our
 * vite binds `127.0.0.1:3000`, and which one answers a request is not deterministic — so the
 * suite could fail wholesale against someone else's app. `E2E_PORT=3100 npm run test:e2e` gets
 * an unambiguous server. Defaults to 3000 so CI and habit are unchanged.
 */
const PORT = process.env.E2E_PORT || '3000'
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    baseURL: BASE_URL,
    headless: !process.env.HEADED,
    launchOptions: {
      slowMo: process.env.HEADED ? 600 : 0,
    },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    // `strictPort` so vite fails loudly instead of silently landing on 3001 and leaving the
    // browser talking to whatever else holds the port.
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 20000,
  },
})
