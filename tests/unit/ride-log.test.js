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
}

beforeEach(() => startRideLog(SESSION))
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

  test('starting a new ride clears the previous one', () => {
    logSim(SIM)
    logGear(11, 10, 2.22, 'shiftDown')
    expect(rideLogSummary().events).toBeGreaterThan(2)
    startRideLog(SESSION)
    expect(rideLogSummary()).toMatchObject({ events: 1, sim: 0, gear: 0 })
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
