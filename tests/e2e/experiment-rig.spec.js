import { test, expect } from '@playwright/test'
import path from 'node:path'

/**
 * DRY RUN for the hardware experiment rigs.
 *
 * Exists because experiment 18's first run on 2026-08-06 wasted a 34-minute ride: the phase
 * selector used a counter that survived workout restarts, so both phases ran as Cw and the entire
 * Crr arm was silently lost. Nothing on the HUD could show it — the label agreed with the wrong
 * decision the script had already made.
 *
 * One headless pass through the plan would have caught it in seconds. So: any script that a rider
 * depends on mid-effort gets dry-run here first, and the assertion is on the DECISION the script
 * makes, not merely that it loaded without throwing.
 */
const MOCK = `
  class MockFtms {
    constructor(){ this.map=new Map(); this.virtualGear=null }
    on(e,f){ if(!this.map.has(e)) this.map.set(e,[]); this.map.get(e).push(f) }
    emit(e,d){ (this.map.get(e)||[]).forEach(f=>{try{f(d)}catch(x){console.error(x)}}) }
    async connect(){ window.dispatchEvent(new CustomEvent('ftmsConnecting'));
      await new Promise(r=>setTimeout(r,20)); window.dispatchEvent(new CustomEvent('ftmsConnected')) }
    async setErgWatts(){} async setSim(){} async rampSim(){}
  }
  window.ftms=new MockFtms(); window.__ftmsMock=window.ftms
`
/**
 * Vite's `/@fs/` prefix needs an ABSOLUTE path, resolved at runtime from the repo root.
 *
 * These were hardcoded to one machine's checkout: they passed locally and 404'd in CI, and were the
 * only failure left once the webServer timeout was fixed — introduced by the very commit that added
 * this spec to make the experiment rig rigorous. `process.cwd()` is the repo root when Playwright
 * is launched from package.json.
 */
const fsUrl = (rel) => `/@fs${path.resolve(process.cwd(), rel)}`
const SCRIPT = fsUrl('docs/virtual-shifting/experiments/18-auto-toggle.js')
const INSTALL = fsUrl('docs/virtual-shifting/experiments/18-install-toggle-workout.js')

async function boot(page) {
  await page.route('**/ftms.js*', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: MOCK })
  )
  await page.goto('/')
  await page.waitForFunction(() => !!window.Hybrid?.handlers?.connectTrainer, { timeout: 10000 })
}

test('phase selection is Crr then Cw, and survives a restart', async ({ page }) => {
  const notes = []
  page.on('console', (m) => {
    const t = m.text()
    if (/\[18\]|physicsApplied/.test(t)) notes.push(t)
  })
  await boot(page)
  await page.evaluate((u) => import(u), INSTALL)
  await page.waitForTimeout(1500)
  await page.waitForFunction(() => !!window.Hybrid?.handlers?.connectTrainer, { timeout: 10000 })
  await page.getByRole('button', { name: 'Connect Trainer' }).click()
  await page.evaluate((u) => import(u), SCRIPT)
  await page.waitForFunction(() => !!window.__auto18, { timeout: 5000 })

  const phaseAtStep = async (idx) =>
    page.evaluate((i) => {
      window.dispatchEvent(new CustomEvent('workoutStepChanged', { detail: { stepIndex: i } }))
      return window.__auto18.phaseName?.() ?? null
    }, idx)

  // Plan is [erg, sim, erg, sim, erg]; SIM steps are index 1 and 3.
  const run1 = { s1: await phaseAtStep(1), s3: await phaseAtStep(3) }
  // RESTART without re-pasting — the exact sequence that lost the Crr arm.
  const run2 = { s1: await phaseAtStep(1), s3: await phaseAtStep(3) }
  console.log('DRYRUN run1:', JSON.stringify(run1), 'run2:', JSON.stringify(run2))

  expect(run1.s1).toBe('Crr')
  expect(run1.s3).toBe('Cw')
  expect(run2.s1).toBe('Crr') // must NOT drift to Cw on a restart
  expect(run2.s3).toBe('Cw')
})
