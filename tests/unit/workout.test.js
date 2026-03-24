import { describe, test, expect } from 'vitest'
import {
  calculateErgDistance,
  calculateErgProgress,
  buildStepSummary,
  buildWorkoutSummary,
} from '../../src/services/workoutService'

// ── calculateErgDistance ──────────────────────────────────────────────────────

describe('calculateErgDistance', () => {
  test('zero speed → zero distance', () => {
    expect(calculateErgDistance(0, 0, 60000)).toBe(0)
  })

  test('30 kph for 2 minutes → ~1000 m', () => {
    const dist = calculateErgDistance(0, 30, 120_000)
    expect(dist).toBeCloseTo(1000, 0)
  })

  test('36 kph for 1 second → 10 m', () => {
    const dist = calculateErgDistance(0, 36, 1000)
    expect(dist).toBeCloseTo(10, 3)
  })

  test('distance scales linearly with duration', () => {
    const d1 = calculateErgDistance(0, 20, 60_000)
    const d2 = calculateErgDistance(0, 20, 120_000)
    expect(d2).toBeCloseTo(d1 * 2, 5)
  })
})

// ── calculateErgProgress ──────────────────────────────────────────────────────

describe('calculateErgProgress', () => {
  test('0% at step start', () => {
    expect(calculateErgProgress(1000, 5, 1000)).toBe(0)
  })

  test('50% at half duration', () => {
    const start = 0
    const halfMs = (5 * 60 * 1000) / 2 // 2.5 min in ms
    expect(calculateErgProgress(start, 5, halfMs)).toBeCloseTo(50, 1)
  })

  test('100% at full duration', () => {
    const start = 0
    const fullMs = 10 * 60 * 1000
    expect(calculateErgProgress(start, 10, fullMs)).toBe(100)
  })

  test('caps at 100% past duration', () => {
    expect(calculateErgProgress(0, 5, 999_999_999)).toBe(100)
  })

  test('floors elapsed to whole seconds', () => {
    // 59 999 ms → floor to 59 s → 59/60 * 100 ≈ 98.3%  (not 100%)
    expect(calculateErgProgress(0, 1, 59_999)).toBeCloseTo(98.33, 1)
    // 60 000 ms → floor to 60 s → exactly 100%
    expect(calculateErgProgress(0, 1, 60_000)).toBe(100)
  })
})

// ── buildStepSummary ──────────────────────────────────────────────────────────

function makeWorkoutState(overrides = {}) {
  return {
    stepStartTime: 0,
    stepSimDistance: 0,
    simDistanceTraveled: 0,
    routeCompleted: false,
    ...overrides,
  }
}

describe('buildStepSummary — ERG step', () => {
  const ergStep = { type: 'erg', duration: 5, power: 200 }

  test('calculates duration correctly', () => {
    const s = buildStepSummary(ergStep, 0, makeWorkoutState(), 0, 120_000)
    expect(s.actualDuration).toBe(120)
  })

  test('plannedDuration converts minutes to seconds', () => {
    const s = buildStepSummary(ergStep, 0, makeWorkoutState(), 0, 0)
    expect(s.plannedDuration).toBe(300)
  })

  test('distance and speed based on speedKph', () => {
    const s = buildStepSummary(ergStep, 0, makeWorkoutState(), 30, 120_000)
    expect(s.distance).toBeCloseTo(1000, 0)
    expect(s.averageSpeed).toBeCloseTo(30, 1)
  })

  test('target is formatted power string', () => {
    const s = buildStepSummary(ergStep, 0, makeWorkoutState(), 0, 0)
    expect(s.target).toBe('200W')
  })

  test('routeDistance and routeCompleted are null', () => {
    const s = buildStepSummary(ergStep, 0, makeWorkoutState(), 0, 0)
    expect(s.routeDistance).toBeNull()
    expect(s.routeCompleted).toBeNull()
  })

  test('stepNumber is 1-based', () => {
    expect(buildStepSummary(ergStep, 0, makeWorkoutState(), 0, 0).stepNumber).toBe(1)
    expect(buildStepSummary(ergStep, 2, makeWorkoutState(), 0, 0).stepNumber).toBe(3)
  })

  test('clamps negative distance to zero', () => {
    // speed=0, but stepStartTime in the future creates negative duration → distance=0
    const W = makeWorkoutState({ stepStartTime: 999_999 })
    const s = buildStepSummary(ergStep, 0, W, 30, 0)
    expect(s.distance).toBe(0)
    expect(s.averageSpeed).toBe(0)
  })
})

describe('buildStepSummary — SIM step', () => {
  const simStep = { type: 'sim', segmentName: 'Test Route' }

  test('uses stepSimDistance for distance', () => {
    const W = makeWorkoutState({
      stepSimDistance: 6000,
      simDistanceTraveled: 5000,
      routeCompleted: true,
    })
    const s = buildStepSummary(simStep, 0, W, 0, 900_000)
    expect(s.distance).toBe(6000)
    expect(s.routeDistance).toBe(5000)
    expect(s.routeCompleted).toBe(true)
  })

  test('target is Route Grade', () => {
    const s = buildStepSummary(simStep, 0, makeWorkoutState(), 0, 0)
    expect(s.target).toBe('Route Grade')
  })

  test('plannedDuration is null (SIM has no fixed duration)', () => {
    const s = buildStepSummary(simStep, 0, makeWorkoutState(), 0, 0)
    expect(s.plannedDuration).toBeNull()
  })

  test('segmentName preserved', () => {
    const s = buildStepSummary(simStep, 0, makeWorkoutState(), 0, 0)
    expect(s.segmentName).toBe('Test Route')
  })

  test('averageSpeed computed from distance and duration', () => {
    // 6 km in 15 min = 24 kph
    const W = makeWorkoutState({ stepSimDistance: 6000, stepStartTime: 0 })
    const s = buildStepSummary(simStep, 0, W, 0, 900_000)
    expect(s.averageSpeed).toBeCloseTo(24, 1)
  })
})

// ── buildWorkoutSummary ───────────────────────────────────────────────────────

describe('buildWorkoutSummary', () => {
  test('empty step list → zero totals', () => {
    const s = buildWorkoutSummary([], 0, 300_000)
    expect(s.totalTime).toBe(300)
    expect(s.totalDistance).toBe(0)
    expect(s.averageSpeed).toBe(0)
    expect(s.steps).toHaveLength(0)
  })

  test('sums distances from all steps', () => {
    const steps = [{ distance: 1000 }, { distance: 2000 }, { distance: 500 }]
    const s = buildWorkoutSummary(steps, 0, 600_000)
    expect(s.totalDistance).toBe(3500)
  })

  test('computes average speed correctly', () => {
    // 3.6 km in 6 minutes = 36 kph
    const s = buildWorkoutSummary([{ distance: 3600 }], 0, 360_000)
    expect(s.averageSpeed).toBeCloseTo(36, 1)
  })

  test('includes timestamp as numeric ms epoch', () => {
    const s = buildWorkoutSummary([], 0, 1_700_000_000_000)
    expect(typeof s.timestamp).toBe('number')
    expect(s.timestamp).toBe(1_700_000_000_000)
  })

  test('steps array is the passed-in array', () => {
    const steps = [{ distance: 100 }]
    expect(buildWorkoutSummary(steps, 0, 60_000).steps).toBe(steps)
  })
})
