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
    // 60s because a cold CI container has no optimizeDeps cache. Locally it is ~2s.
    timeout: 60000,
    /**
     * Pipe the server's output. Without this Playwright swallows it, and a `webServer` timeout in
     * CI reports only "Timed out waiting Nms" with nothing to diagnose — which is why the E2E job
     * failed on every push from 2026-07-30 to 2026-08-07 without anyone being able to see why.
     */
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
