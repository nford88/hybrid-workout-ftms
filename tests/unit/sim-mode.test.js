import { describe, test, expect } from 'vitest'
import { calculateRealisticGrade } from '../../src/services/simPhysics'
import { getGradeForDistance } from '../../src/services/routeService'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeGradeState(overrides = {}) {
  return {
    currentGrade: 0,
    targetGrade: 0,
    lastGradeUpdate: null,
    lastGradeDistance: 0,
    ...overrides,
  }
}

// ── Gradient Smoothing ────────────────────────────────────────────────────────

describe('calculateRealisticGrade', () => {
  test('initializes grade on first call (lastGradeUpdate = 0)', () => {
    const state = makeGradeState()
    const result = calculateRealisticGrade(5.0, 20, 100, state, 1000)
    expect(result).toBe(5.0)
    expect(state.currentGrade).toBe(5.0)
    expect(state.targetGrade).toBe(5.0)
  })

  test('limits grade change to MAX_GRADE_CHANGE_PER_RAMP (1.5%) per 10m', () => {
    const state = makeGradeState()
    calculateRealisticGrade(0, 20, 0, state, 0) // init at 0%
    const result = calculateRealisticGrade(10, 20, 10, state, 100) // try to jump to 10% after 10m
    expect(Math.abs(result - 0)).toBeLessThanOrEqual(1.5)
  })

  test('applies momentum assistance — higher speed → lower effective grade', () => {
    const lowState = makeGradeState()
    calculateRealisticGrade(5, 5, 0, lowState, 0)
    const lowResult = calculateRealisticGrade(5, 5, 10, lowState, 1000)

    const highState = makeGradeState()
    calculateRealisticGrade(5, 30, 0, highState, 0)
    const highResult = calculateRealisticGrade(5, 30, 10, highState, 1000)

    expect(highResult).toBeLessThan(lowResult)
  })

  /**
   * Regression guard for the gear-shift path. `forceSimGradeUpdate` called `setSimGrade`
   * without `currentSpeed`, which defaulted to 0 — so every shift told this function the bike
   * was stationary, zeroing the momentum factor. The 2026-08-07 workout log shows the same
   * 22.7% hill sent as 0.49% on the timer path (speed 16.7 kph) and 4.90% on a shift, seconds
   * apart. `setSimGrade` now defaults both to live telemetry.
   */
  test('a stationary reading loses momentum assistance entirely — 33% more grade', () => {
    const movingState = makeGradeState()
    calculateRealisticGrade(8, 20, 0, movingState, 0)
    const moving = calculateRealisticGrade(8, 20, 10, movingState, 1000)

    const stoppedState = makeGradeState()
    calculateRealisticGrade(8, 0, 0, stoppedState, 0)
    const stopped = calculateRealisticGrade(8, 0, 10, stoppedState, 1000)

    // Above 12 kph the reduction saturates at 25%, so speed 0 sends 1/0.75 = 1.333x as much.
    expect(stopped).toBeGreaterThan(moving)
    expect(stopped / moving).toBeCloseTo(1 / 0.75, 5)
  })

  test('momentum assistance saturates at 12 kph, so it cannot keep growing with speed', () => {
    const at12 = makeGradeState()
    calculateRealisticGrade(8, 12, 0, at12, 0)
    const twelve = calculateRealisticGrade(8, 12, 10, at12, 1000)

    const at50 = makeGradeState()
    calculateRealisticGrade(8, 50, 0, at50, 0)
    const fifty = calculateRealisticGrade(8, 50, 10, at50, 1000)

    expect(fifty).toBeCloseTo(twelve, 10)
  })

  test('clamps negative grade to -2% floor', () => {
    const state = makeGradeState()
    calculateRealisticGrade(0, 10, 0, state, 0)
    const result = calculateRealisticGrade(-5, 50, 100, state, 1000)
    expect(result).toBeGreaterThanOrEqual(-2)
  })

  test('smooths grade changes over time', () => {
    const state = makeGradeState()
    calculateRealisticGrade(0, 20, 0, state, 0) // start flat

    const grade1 = calculateRealisticGrade(3, 20, 20, state, 100) // 3% after 20m
    const grade2 = calculateRealisticGrade(3, 20, 30, state, 600) // 0.5s later

    expect(grade2).toBeGreaterThanOrEqual(grade1)
    expect(grade2).toBeLessThan(3) // not yet at target
  })

  test('no grade change when distance < 10m', () => {
    const state = makeGradeState()
    calculateRealisticGrade(0, 20, 0, state, 0) // init at 0%
    const result = calculateRealisticGrade(8, 20, 5, state, 100) // only 5m traveled
    // Target should be locked to current (0%), so grade stays near 0
    expect(Math.abs(result)).toBeLessThan(1.5)
  })

  test('returns consistent results for zero speed (no momentum)', () => {
    const state = makeGradeState()
    calculateRealisticGrade(5, 0, 0, state, 0)
    const result = calculateRealisticGrade(5, 0, 10, state, 1000)
    // momentum factor = 0, so result equals newGrade unchanged
    expect(result).toBeCloseTo(state.currentGrade, 3)
  })
})

// ── SIM Mode Integration ──────────────────────────────────────────────────────

describe('SIM mode integration', () => {
  test('getGradeForDistance returns expected grades along a known route', () => {
    const route = [
      { distance: 0, grade: 0 },
      { distance: 1000, grade: 5 },
      { distance: 2000, grade: 0 },
      { distance: 3000, grade: -3 },
    ]
    expect(getGradeForDistance(500, route)).toBe(5)
    expect(getGradeForDistance(1500, route)).toBe(0)
    expect(getGradeForDistance(2500, route)).toBe(-3)
  })

  test('calculateRealisticGrade smooths a sudden grade spike from route', () => {
    const state = makeGradeState()
    // Start flat, then suddenly hit a 10% spike
    calculateRealisticGrade(0, 20, 0, state, 0)
    const result = calculateRealisticGrade(10, 20, 10, state, 500)
    // Should be smoothed — nowhere near 10%
    expect(result).toBeLessThan(5)
  })

  test('momentum + grade smoothing pipeline produces plausible trainer values', () => {
    const state = makeGradeState()
    calculateRealisticGrade(5, 25, 0, state, 0)

    const results = []
    let dist = 0
    for (let t = 100; t <= 1000; t += 100) {
      dist += 2 // 2m per 100ms at ~72kph
      results.push(calculateRealisticGrade(5, 25, dist, state, t))
    }
    // All values should be reasonable trainer grades
    results.forEach((g) => {
      expect(g).toBeGreaterThan(-2)
      expect(g).toBeLessThan(10)
    })
  })
})
