import { test, expect } from '@playwright/test'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const LEAP_LANE = require('./fixtures/leap-lane-hills.json')

// ─── FTMS mock ────────────────────────────────────────────────────────────────
// Replaces ftms.js entirely so no real BLE code runs. Tests that need a
// "connected" trainer use loadApp(); the BLE dialog test uses loadAppWithBluetoothSpy().

const FTMS_MOCK_BODY = `
  class MockFtms {
    constructor() {
      this.map = new Map()
      this.virtualGear = null
    }
    on(event, fn) {
      if (!this.map.has(event)) this.map.set(event, [])
      this.map.get(event).push(fn)
    }
    emit(event, data) {
      ;(this.map.get(event) || []).forEach(fn => { try { fn(data) } catch(e) { console.error(e) } })
    }
    async connect() {
      window.dispatchEvent(new CustomEvent('ftmsConnecting'))
      await new Promise(r => setTimeout(r, 30))
      window.dispatchEvent(new CustomEvent('ftmsConnected'))
    }
    async setErgWatts() {}
    async setSim() {}
    async rampSim() {}
  }
  window.ftms = new MockFtms()
  window.__ftmsMock = window.ftms
`

async function emitIbd(page, { powerW = 0, speedKph = 0, cadenceRpm = 0 } = {}) {
  await page.evaluate(
    ({ powerW, speedKph, cadenceRpm }) => {
      window.__ftmsMock.emit('ibd', { powerW, speedKph, cadenceRpm })
    },
    { powerW, speedKph, cadenceRpm }
  )
}

// Standard loader — ftms.js replaced with mock
async function loadApp(page) {
  await page.route('**/ftms.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: FTMS_MOCK_BODY,
    })
  )
  await page.goto('/')
  await page.waitForFunction(() => !!window.Hybrid?.handlers?.connectTrainer, { timeout: 5000 })
}

// BLE spy loader — real ftms.js loads but navigator.bluetooth is intercepted so
// requestDevice() rejects immediately (simulates user cancelling the picker).
async function loadAppWithBluetoothSpy(page) {
  await page.addInitScript(() => {
    window.__bluetoothRequestDeviceCalled = false
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: () => {
          window.__bluetoothRequestDeviceCalled = true
          return Promise.reject(new DOMException('User cancelled', 'NotFoundError'))
        },
        getAvailability: () => Promise.resolve(true),
      },
      configurable: true,
      writable: true,
    })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!window.Hybrid?.handlers?.connectTrainer, { timeout: 5000 })
}

// Headed with slowMo locally; headless in CI (set HEADED=1 to force headed locally).
// Run with: HEADED=1 npx playwright test tests/e2e/user-flows.spec.js
const isHeaded = !!process.env.HEADED
test.use({ headless: !isHeaded, launchOptions: { slowMo: isHeaded ? 400 : 0 } })

// ─── Test 1: UI Interactions ──────────────────────────────────────────────────

test.describe('Test 1: UI Interactions', () => {
  test('Connect Trainer fires Bluetooth requestDevice (auto-cancelled)', async ({ page }) => {
    await loadAppWithBluetoothSpy(page)

    await page.getByRole('button', { name: 'Connect Trainer' }).click()

    // requestDevice is called immediately — our spy rejects it (cancel simulation)
    await page.waitForFunction(() => window.__bluetoothRequestDeviceCalled === true, {
      timeout: 3000,
    })
    expect(await page.evaluate(() => window.__bluetoothRequestDeviceCalled)).toBe(true)

    // After cancel, status must stay Disconnected — not flip to Connected
    await expect(page.getByText('Status: Disconnected')).toBeVisible({ timeout: 2000 })
  })

  test('BLE Debug button opens bluetooth-test popup', async ({ page }) => {
    await loadApp(page)

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('#debug-bluetooth-button').click(),
    ])

    await expect(popup).toHaveURL(/bluetooth-test/)
  })

  test('add ERG steps, delete one, clear all', async ({ page }) => {
    await loadApp(page)

    // Add first ERG step
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('100')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await expect(page.locator('.remove-step-button')).toHaveCount(1)
    await expect(page.getByText('100W').first()).toBeVisible()

    // Add second ERG step
    await page.locator('#erg-duration').fill('10')
    await page.locator('#erg-power').fill('200')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await expect(page.locator('.remove-step-button')).toHaveCount(2)

    // Delete first step — 100W gone, 200W remains
    await page.locator('.remove-step-button').first().click()
    await expect(page.locator('.remove-step-button')).toHaveCount(1)
    await expect(page.getByText('200W').first()).toBeVisible()
    await expect(page.getByText('100W')).toHaveCount(0)

    // Clear All — list empties and no-steps message appears
    await page.getByRole('button', { name: 'Clear All' }).click()
    await expect(page.locator('#no-steps')).toBeVisible()
    await expect(page.locator('.remove-step-button')).toHaveCount(0)
  })
})

// ─── Test 2: Full ERG → ERG → SIM → ERG workout ──────────────────────────────

test.describe('Test 2: Full Workout Flow', () => {
  test.setTimeout(60000)

  test('ERG 100W → ERG 200W → SIM (Leap Lane Hills) → ERG 250W completes with summary', async ({
    page,
  }) => {
    const consoleLogs = []
    page.on('console', (msg) => consoleLogs.push(msg.text()))

    await loadApp(page)

    // ── Connect trainer ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Connect Trainer' }).click()
    await expect(page.getByText('Status: Connected')).toBeVisible({ timeout: 3000 })

    // ── Import real route ────────────────────────────────────────────────────
    await page.locator('#garmin-data').fill(JSON.stringify(LEAP_LANE))
    await page.getByRole('button', { name: 'Import Route' }).click()
    await expect(page.locator('#segment-name')).toHaveText('Leap Lane Hills', { timeout: 2000 })

    // ── Build 4-step workout (0.05 min ≈ 3 seconds per ERG step) ────────────
    await page.locator('#erg-duration').fill('0.05')
    await page.locator('#erg-power').fill('100')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await page.locator('#erg-duration').fill('0.05')
    await page.locator('#erg-power').fill('200')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await page.locator('#step-type').selectOption('sim')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await page.locator('#step-type').selectOption('erg')
    await page.locator('#erg-duration').fill('0.05')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await expect(page.locator('.remove-step-button')).toHaveCount(4)

    // ── Start ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    // ── Step 1: ERG 100W — emit IBD and verify live metrics, then auto-advance ─
    await expect(page.locator('#target-display')).toContainText('100W', { timeout: 2000 })
    await expect(page.locator('#workout-progress-text')).toContainText('Step 1/4', {
      timeout: 2000,
    })
    await emitIbd(page, { powerW: 98, speedKph: 28.5, cadenceRpm: 88 })
    await expect(page.getByText('98')).toBeVisible({ timeout: 2000 })
    await expect(page.getByText('28.5')).toBeVisible()
    await expect(page.getByText('88')).toBeVisible()
    await page.waitForTimeout(4500)

    // ── Step 2: ERG 200W — confirm step counter advanced, then auto-advance ──
    await expect(page.locator('#target-display')).toContainText('200W', { timeout: 3000 })
    await expect(page.locator('#workout-progress-text')).toContainText('Step 2/4', {
      timeout: 2000,
    })
    await page.waitForTimeout(4500)

    // ── Step 3: SIM — verify gradient shows a real value, then skip ─────────
    await expect(page.locator('#target-display')).toContainText('km', { timeout: 3000 })
    await expect(page.locator('#workout-progress-text')).toContainText('Step 3/4', {
      timeout: 2000,
    })
    await emitIbd(page, { powerW: 180, speedKph: 25, cadenceRpm: 80 })
    await page.waitForTimeout(3000) // wait past 2s SIM throttle
    const gradientText = await page
      .locator('.metric-card-compact')
      .filter({ hasText: 'GRADIENT' })
      .locator('.metric-value')
      .textContent()
    expect(gradientText).toMatch(/^[+-]?\d+\.\d+$/) // e.g. "+4.2", "-1.5", "0.0" — % is a separate unit element
    await page.getByRole('button', { name: 'Skip Step' }).click()

    // ── Step 4: ERG 250W — let it auto-complete naturally ────────────────────
    await expect(page.locator('#target-display')).toContainText('250W', { timeout: 3000 })
    await expect(page.locator('#workout-progress-text')).toContainText('Step 4/4', {
      timeout: 2000,
    })
    await page.waitForTimeout(4500)

    // ── Workout complete ─────────────────────────────────────────────────────
    await expect(page.getByText('Build Workout')).toBeVisible({ timeout: 5000 })

    // ── Console summary was generated ────────────────────────────────────────
    expect(consoleLogs.some((l) => l.includes('=== WORKOUT SUMMARY (Garmin Compatible) ==='))).toBe(
      true
    )
    expect(consoleLogs.some((l) => l.includes('Steps Completed: 4'))).toBe(true)
  })
})
