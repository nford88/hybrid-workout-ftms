import { test, expect } from '@playwright/test'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const LEAP_LANE = require('./fixtures/leap-lane-hills.json')

// Replaces ftms.js entirely via network interception so the real Web Bluetooth
// code never runs. The mock exposes window.__ftmsMock so tests can push IBD
// data and simulate connect/disconnect at will.
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

// Push a single IBD packet through the mock
async function emitIbd(page, { powerW = 0, speedKph = 0, cadenceRpm = 0 } = {}) {
  await page.evaluate(
    ({ powerW, speedKph, cadenceRpm }) => {
      window.__ftmsMock.emit('ibd', { powerW, speedKph, cadenceRpm })
    },
    { powerW, speedKph, cadenceRpm }
  )
}

// ─── Shared setup ────────────────────────────────────────────────────────────

async function loadApp(page) {
  // Intercept ftms.js so the real Web Bluetooth code never loads
  await page.route('**/ftms.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: FTMS_MOCK_BODY,
    })
  )
  await page.goto('/')
  // Wait for main.js to finish booting
  await page.waitForFunction(() => !!window.Hybrid?.handlers?.connectTrainer, { timeout: 5000 })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Setup View', () => {
  test('renders initial state correctly', async ({ page }) => {
    await loadApp(page)

    await expect(page.getByText('FTMS Hybrid Workout')).toBeVisible()
    await expect(page.getByText('Status: Disconnected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect Trainer' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start Workout' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import Route' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Step' })).toBeVisible()
  })
})

test.describe('Trainer Connection', () => {
  test('Connect Trainer button updates status to Connected', async ({ page }) => {
    await loadApp(page)

    await page.getByRole('button', { name: 'Connect Trainer' }).click()
    await expect(page.getByText('Status: Connected')).toBeVisible({ timeout: 3000 })
  })
})

test.describe('ERG Workout', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page)
    // Connect trainer
    await page.getByRole('button', { name: 'Connect Trainer' }).click()
    await expect(page.getByText('Status: Connected')).toBeVisible({ timeout: 3000 })
  })

  test('adds an ERG step and shows it in the plan', async ({ page }) => {
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('200')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await expect(page.getByText('ERG:', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('200W').first()).toBeVisible()
  })

  test('starts workout, switches to active view, shows metrics', async ({ page }) => {
    // Add a step
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()

    // Start workout
    await page.getByRole('button', { name: 'Start Workout' }).click()

    // Active view should appear with MetricsRow
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })
    await expect(page.getByRole('heading', { name: 'Power' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Speed' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Cadence' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible()
  })

  test('metrics update when IBD data arrives', async ({ page }) => {
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    // Push IBD data through mock
    await emitIbd(page, { powerW: 245, speedKph: 32.4, cadenceRpm: 91 })

    await expect(page.getByText('245')).toBeVisible({ timeout: 2000 })
    await expect(page.getByText('32.4')).toBeVisible()
    await expect(page.getByText('91')).toBeVisible()
  })

  test('time ticks while workout is running', async ({ page }) => {
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    const timeBefore = await page.locator('.metric-value.text-purple-400').textContent()
    await page.waitForTimeout(2100)
    const timeAfter = await page.locator('.metric-value.text-purple-400').textContent()

    expect(timeBefore).not.toEqual(timeAfter)
  })

  test('Skip Step ends single-step workout', async ({ page }) => {
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    await page.getByRole('button', { name: 'Skip Step' }).click()

    // Should return to setup view after workout ends
    await expect(page.getByText('Build Workout')).toBeVisible({ timeout: 3000 })
  })

  test('gradient shows dash in ERG mode', async ({ page }) => {
    await page.locator('#erg-duration').fill('5')
    await page.locator('#erg-power').fill('250')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    // Gradient card should show — in ERG mode
    const gradientCard = page.locator('.metric-card-compact').filter({ hasText: 'GRADIENT' })
    await expect(gradientCard.locator('.metric-value')).toHaveText('—')
  })
})

test.describe('SIM Workout', () => {
  // Real route recorded from Leap Lane Hills (Dublin), 8.3 km, avg grade 1.3%
  const MOCK_ROUTE = JSON.stringify(LEAP_LANE)

  test.beforeEach(async ({ page }) => {
    await loadApp(page)
    await page.getByRole('button', { name: 'Connect Trainer' }).click()
    await expect(page.getByText('Status: Connected')).toBeVisible({ timeout: 3000 })

    // Import the real route
    await page.locator('#garmin-data').fill(MOCK_ROUTE)
    await page.getByRole('button', { name: 'Import Route' }).click()
    await expect(page.locator('#segment-name')).toHaveText('Leap Lane Hills', { timeout: 2000 })
  })

  test('adds a SIM step and shows it in the plan', async ({ page }) => {
    await page.locator('#step-type').selectOption('sim')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await expect(page.getByText('SIM:').first()).toBeVisible()
    await expect(page.locator('#segment-name')).toHaveText('Leap Lane Hills')
  })

  test('SIM workout shows gradient when IBD speed arrives', async ({ page }) => {
    await page.locator('#step-type').selectOption('sim')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    // Push speed data — SIM mode computes gradient from route
    await emitIbd(page, { powerW: 200, speedKph: 25, cadenceRpm: 80 })
    await page.waitForTimeout(3000) // SIM throttles to 2s intervals

    // Gradient should now show a value (not dash) since route has elevation
    const gradientCard = page.locator('.metric-card-compact').filter({ hasText: 'GRADIENT' })
    const gradientText = await gradientCard.locator('.metric-value').textContent()
    expect(gradientText).not.toBe('—')
  })

  test('ERG auto-advances to SIM after duration expires', async ({ page }) => {
    // Add a very short ERG step (0.05 min = 3 seconds) followed by a SIM step
    await page.locator('#erg-duration').fill('0.05')
    await page.locator('#erg-power').fill('200')
    await page.getByRole('button', { name: 'Add Step' }).click()

    await page.locator('#step-type').selectOption('sim')
    await page.getByRole('button', { name: 'Add Step' }).click()

    // Confirm plan has both steps
    await expect(page.getByText('ERG:').first()).toBeVisible()
    await expect(page.getByText('SIM:').first()).toBeVisible()

    // Start — should land on ERG step first
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('#target-display')).toContainText('200W', { timeout: 2000 })

    // ERG step auto-advances after ~3s — wait a little past that
    await page.waitForTimeout(4500)

    // Should now be on the SIM step — target display switches away from fixed watts
    await expect(page.locator('#target-display')).not.toContainText('200W', { timeout: 3000 })

    // Push speed data so SIM computes a gradient
    await emitIbd(page, { powerW: 180, speedKph: 28, cadenceRpm: 82 })
    await page.waitForTimeout(3000)

    // Gradient card should show a real value (route has 50m elevation gain)
    const gradientCard = page.locator('.metric-card-compact').filter({ hasText: 'GRADIENT' })
    const gradientText = await gradientCard.locator('.metric-value').textContent()
    expect(gradientText).not.toBe('—')
  })

  test('step distance updates during SIM step', async ({ page }) => {
    await page.locator('#step-type').selectOption('sim')
    await page.getByRole('button', { name: 'Add Step' }).click()
    await page.getByRole('button', { name: 'Start Workout' }).click()
    await expect(page.getByText('Workout Progress')).toBeVisible({ timeout: 3000 })

    // Emit speed data a few times to accumulate distance
    for (let i = 0; i < 5; i++) {
      await emitIbd(page, { powerW: 200, speedKph: 30, cadenceRpm: 85 })
      await page.waitForTimeout(2200) // past the 2s SIM throttle
    }

    // Step Distance should show meters, not dash
    const stepDist = page.locator('text=Step Distance').locator('..').locator('.text-lg')
    const distText = await stepDist.textContent()
    expect(distText).not.toBe('—')
  })
})
