import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  startRideLog,
  logSim,
  logGear,
  logStep,
  logTelemetry,
  logNote,
  getRideLog,
  rideLogSummary,
  rideLogJson,
  resetRideLog,
} from '../../src/services/rideLog'

const SESSION = {
  massKg: 92,
  crr: 0.017,
  cw: 0.51,
  chainringTeeth: 34,
  cogTeeth: 14,
  physicalRatio: 34 / 14,
  wheelCircumferenceM: 2.096,
  gearTable: [0.75, 2.4, 5.49],
}

const SIM = {
  routeDistanceM: 4200,
  rawGradePct: 1.8,
  realisticGradePct: 1.6,
  sentGradePct: -0.63,
  gearIndex: 4,
  gearRatio: 1.23,
  physicalRatio: 34 / 14,
  targetPowerW: 120,
  virtualSpeedKph: 13.1,
  coasting: false,
  clamped: false,
  crr: 0.004,
  cw: 0.51,
}

beforeEach(() => {
  // Archived runs outlive a single startRideLog by design, so tests must start truly clean.
  resetRideLog()
  startRideLog(SESSION)
})
afterEach(() => vi.useRealTimers())

describe('rideLog — the record a head unit cannot make', () => {
  test('opens with a self-describing session header', () => {
    const [first] = getRideLog()
    expect(first.type).toBe('session')
    expect(first.session.crr).toBe(0.017)
    expect(first.session.chainringTeeth).toBe(34)
    expect(first.session.physicalRatio).toBeCloseTo(2.4286, 4)
    // Without this, an exported file cannot be interpreted six months later.
    expect(first.session.startedAt).toBeGreaterThan(0)
  })

  test('every event carries an absolute timestamp', () => {
    logSim(SIM)
    logGear(11, 10, 2.22, 'shiftDown')
    logStep(2, 'sim', 'Leap Lane Hills')
    logTelemetry(20.4, 86, 100)
    // The 2026-07-29 console dump had none, so aligning it to a FIT file was guesswork.
    const stamps = getRideLog().map((e) => e.t)
    const now = Date.now()
    for (const t of stamps) {
      expect(typeof t).toBe('number')
      expect(Number.isFinite(t)).toBe(true)
      expect(Math.abs(now - t)).toBeLessThan(5000) // same clock as Date.now()
    }
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps) // never goes backwards
  })

  test('captures the quantities that exist nowhere else', () => {
    logSim(SIM)
    const sim = getRideLog().find((e) => e.type === 'sim')
    // A Garmin records power/speed/cadence. It cannot record any of these.
    expect(sim.sentGradePct).toBe(-0.63)
    expect(sim.rawGradePct).toBe(1.8)
    expect(sim.gearIndex).toBe(4)
    expect(sim.targetPowerW).toBe(120)
    expect(sim.routeDistanceM).toBe(4200)
  })

  test('carries the Crr/Cw actually sent, so a mid-ride sweep stays attributable', () => {
    // experiments/17 changes tyre and position between laps of one workout. With Crr/Cw only
    // in the session header, every sample of every condition would look identical on export.
    logSim(SIM)
    logSim({ ...SIM, crr: 0.02, cw: 0.2 })
    const [a, b] = getRideLog().filter((e) => e.type === 'sim')
    expect(a).toMatchObject({ crr: 0.004, cw: 0.51 })
    expect(b).toMatchObject({ crr: 0.02, cw: 0.2 })
  })

  test('records shifts, which left no trace at all on the first ride', () => {
    logGear(11, 10, 2.22, 'shiftDown')
    logGear(10, 11, 2.4, 'shiftUp')
    const shifts = getRideLog().filter((e) => e.type === 'gear')
    expect(shifts).toHaveLength(2)
    expect(shifts[0]).toMatchObject({ from: 11, to: 10, action: 'shiftDown' })
  })

  test('telemetry is throttled to ~1 Hz so it stays alignable but not enormous', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1785405600000)
    startRideLog(SESSION)
    for (let i = 0; i < 20; i += 1) logTelemetry(20, 85, 150) // same instant
    expect(rideLogSummary().telemetry).toBe(1)
    vi.setSystemTime(1785405601000)
    logTelemetry(21, 86, 155)
    expect(rideLogSummary().telemetry).toBe(2)
  })

  test('telemetry carries the state in force, so no analysis has to reconstruct it', () => {
    // The 2026-08-05 analysis re-integrated cadence to recover route distance and step-held
    // gear/sent-grade/Crr/Cw from `sim` events — of which a whole lap produced ten, because the
    // 0.3% deadband suppresses writes. Every filter the experiment relies on was inferred.
    logTelemetry(24.5, 85, 187, {
      routeDistanceM: 412.5,
      gearIndex: 11,
      gearRatio: 2.4,
      sentGradePct: -0.09,
      crr: 0.004,
      cw: 0.51,
    })
    const t = getRideLog().find((e) => e.type === 'telemetry')
    expect(t).toMatchObject({
      speedKph: 24.5,
      cadenceRpm: 85,
      powerW: 187,
      routeDistanceM: 412.5,
      gearIndex: 11,
      gearRatio: 2.4,
      sentGradePct: -0.09,
      crr: 0.004,
      cw: 0.51,
    })
  })

  test('telemetry state is nullable, not undefined — a sample before the first grade decision', () => {
    // A telemetry sample can arrive before any sim write in a step. Nulls survive JSON; undefined
    // keys vanish silently and would look identical to a field we forgot to record.
    logTelemetry(0, 0, 0)
    const t = getRideLog().find((e) => e.type === 'telemetry')
    const round = JSON.parse(JSON.stringify(t))
    for (const k of ['routeDistanceM', 'gearIndex', 'gearRatio', 'sentGradePct', 'crr', 'cw']) {
      expect(k in round).toBe(true)
      expect(round[k]).toBeNull()
    }
  })

  test('starting a new ride clears the live log but KEEPS the previous run', () => {
    logSim(SIM)
    logGear(11, 10, 2.22, 'shiftDown')
    expect(rideLogSummary().events).toBeGreaterThan(2)
    startRideLog(SESSION)
    expect(rideLogSummary()).toMatchObject({ events: 1, sim: 0, gear: 0, earlierRuns: 1 })
  })

  test('a lap-per-run protocol survives six restarts with all six runs exported', () => {
    // experiments/17 is naturally ridden as stop / change the tyre / start again. Every Start
    // Workout calls startRideLog, so clearing outright exported six laps as one.
    for (let lap = 0; lap < 6; lap += 1) {
      startRideLog(SESSION)
      logStep(0, 'sim', 'Crr/Cw Sweep Lap')
      logSim({ ...SIM, crr: 0.004 + lap * 0.002 })
    }
    const parsed = JSON.parse(rideLogJson())
    // 5 archived + the live one = the 6 laps ridden. Plus the beforeEach session, which had
    // nothing logged into it and so is correctly dropped rather than archived as an empty run.
    expect(parsed.earlierRuns).toHaveLength(5)
    expect(rideLogSummary().earlierRuns).toBe(5)
    const crrPerRun = [...parsed.earlierRuns, parsed.events].map(
      (run) => run.find((e) => e.type === 'sim').crr
    )
    expect(crrPerRun).toEqual([0.004, 0.006, 0.008, 0.01, 0.012, 0.014])
  })

  test('an empty run is not archived, so pressing Start twice costs nothing', () => {
    startRideLog(SESSION)
    startRideLog(SESSION)
    expect(rideLogSummary().earlierRuns).toBe(0)
  })

  test('exports as parseable JSON with a version', () => {
    logSim(SIM)
    logNote('route completed', { distance: 8350 })
    const parsed = JSON.parse(rideLogJson())
    expect(parsed.version).toBe(1)
    expect(parsed.overflowed).toBe(false)
    expect(parsed.events.length).toBe(getRideLog().length)
    expect(parsed.events.find((e) => e.type === 'note').data.distance).toBe(8350)
  })

  test('a full-length ride stays well inside the cap', () => {
    // ~50 min: 3000 telemetry at 1 Hz + 650 grade decisions + 40 shifts.
    vi.useFakeTimers()
    vi.setSystemTime(1785405600000)
    startRideLog(SESSION)
    for (let i = 0; i < 3000; i += 1) {
      vi.setSystemTime(Date.now() + 1000)
      logTelemetry(20, 85, 150)
    }
    for (let i = 0; i < 650; i += 1) logSim(SIM)
    const s = rideLogSummary()
    expect(s.telemetry).toBe(3000)
    expect(s.sim).toBe(650)
    expect(JSON.parse(rideLogJson()).overflowed).toBe(false)
  })
})
