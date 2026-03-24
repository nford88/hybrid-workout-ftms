import { describe, test, expect } from 'vitest'
import {
  GRAPH_CONFIG,
  calculateWorkoutMetrics,
  generateErgPaths,
  generateSimPaths,
  generateStepDividers,
  calculatePositionFraction,
} from '../../src/services/graphService'

// ── calculateWorkoutMetrics ───────────────────────────────────────────────────

describe('calculateWorkoutMetrics', () => {
  test('empty plan → zero duration, empty steps, default maxPower', () => {
    const { totalDuration, steps, maxPower } = calculateWorkoutMetrics([], null)
    expect(totalDuration).toBe(0)
    expect(steps).toHaveLength(0)
    expect(maxPower).toBe(GRAPH_CONFIG.maxPower)
  })

  test('single ERG step — duration converts minutes to seconds', () => {
    const plan = [{ type: 'erg', duration: 10, power: 200 }]
    const { totalDuration, steps } = calculateWorkoutMetrics(plan, null)
    expect(steps).toHaveLength(1)
    expect(steps[0].duration).toBe(600) // 10 min → 600 s
    expect(steps[0].startTime).toBe(0)
    expect(steps[0].endTime).toBe(600)
    expect(totalDuration).toBe(600)
  })

  test('single SIM step — uses route totalDistance when provided', () => {
    const plan = [{ type: 'sim', segmentName: 'Test Route' }]
    const route = { totalDistance: 10000 } // 10 km
    const { steps } = calculateWorkoutMetrics(plan, route)
    expect(steps[0].routeDistance).toBe(10000)
    // 10 km at 25 kph = 1440 s
    expect(steps[0].duration).toBeCloseTo(1440, 0)
  })

  test('single SIM step — defaults to 5000 m when no route', () => {
    const plan = [{ type: 'sim', segmentName: 'Unknown' }]
    const { steps } = calculateWorkoutMetrics(plan, null)
    expect(steps[0].routeDistance).toBe(5000)
  })

  test('multiple steps — cumulative startTime/endTime', () => {
    const plan = [
      { type: 'erg', duration: 5, power: 150 },
      { type: 'erg', duration: 10, power: 200 },
    ]
    const { steps, totalDuration } = calculateWorkoutMetrics(plan, null)
    expect(steps[0].startTime).toBe(0)
    expect(steps[0].endTime).toBe(300)
    expect(steps[1].startTime).toBe(300)
    expect(steps[1].endTime).toBe(900)
    expect(totalDuration).toBe(900)
  })

  test('maxPower rounds up to nearest 50 when plan exceeds default', () => {
    const plan = [{ type: 'erg', duration: 5, power: 420 }]
    const { maxPower } = calculateWorkoutMetrics(plan, null)
    expect(maxPower).toBe(500) // ceil((420+50)/50)*50
  })

  test('maxPower stays at default when all powers are within range', () => {
    const plan = [{ type: 'erg', duration: 5, power: 200 }]
    const { maxPower } = calculateWorkoutMetrics(plan, null)
    expect(maxPower).toBe(GRAPH_CONFIG.maxPower)
  })
})

// ── generateErgPaths ──────────────────────────────────────────────────────────

describe('generateErgPaths', () => {
  test('empty metrics → empty string', () => {
    const metrics = calculateWorkoutMetrics([], null)
    expect(generateErgPaths(metrics)).toBe('')
  })

  test('single ERG step → contains an SVG <path>', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 10, power: 200 }], null)
    const svg = generateErgPaths(metrics)
    expect(svg).toContain('<path')
    expect(svg).toContain('erg-gradient')
  })

  test('SIM-only plan → empty string (no ERG steps)', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'sim', segmentName: 'R' }], null)
    expect(generateErgPaths(metrics)).toBe('')
  })

  test('two ERG steps → two <path> elements', () => {
    const plan = [
      { type: 'erg', duration: 5, power: 150 },
      { type: 'erg', duration: 5, power: 250 },
    ]
    const svg = generateErgPaths(calculateWorkoutMetrics(plan, null))
    const count = (svg.match(/<path/g) || []).length
    expect(count).toBe(2)
  })
})

// ── generateSimPaths ──────────────────────────────────────────────────────────

describe('generateSimPaths', () => {
  test('empty metrics → empty string', () => {
    expect(generateSimPaths(calculateWorkoutMetrics([], null))).toBe('')
  })

  test('SIM step with no route data → flat path at zero line', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'sim', segmentName: 'R' }], null)
    const svg = generateSimPaths(metrics, GRAPH_CONFIG, null, null)
    expect(svg).toContain('<path')
    expect(svg).toContain('sim-gradient-up')
  })

  test('SIM step with route data → profiled path with grade samples', () => {
    const routeData = [
      { distance: 0, grade: 0 },
      { distance: 1000, grade: 5 },
      { distance: 2000, grade: 0 },
    ]
    const getGrade = (d, rd) => rd.find((p) => p.distance >= d)?.grade ?? 0
    const metrics = calculateWorkoutMetrics([{ type: 'sim', segmentName: 'R' }], {
      totalDistance: 2000,
    })
    const svg = generateSimPaths(metrics, GRAPH_CONFIG, routeData, getGrade)
    expect(svg).toContain('<path')
    // profiled path has many L commands (one per sample)
    const lCount = (svg.match(/\bL\b/g) || []).length
    expect(lCount).toBeGreaterThan(5)
  })

  test('ERG-only plan → empty string', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 10, power: 200 }], null)
    expect(generateSimPaths(metrics)).toBe('')
  })
})

// ── generateStepDividers ──────────────────────────────────────────────────────

describe('generateStepDividers', () => {
  test('empty metrics → empty string', () => {
    expect(generateStepDividers(calculateWorkoutMetrics([], null))).toBe('')
  })

  test('single step → label only, no divider line', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 5, power: 200 }], null)
    const svg = generateStepDividers(metrics)
    expect(svg).toContain('ERG')
    expect(svg).not.toContain('<line')
  })

  test('two steps → one divider line and two labels', () => {
    const plan = [
      { type: 'erg', duration: 5, power: 200 },
      { type: 'sim', segmentName: 'R' },
    ]
    const svg = generateStepDividers(calculateWorkoutMetrics(plan, null))
    expect(svg).toContain('<line')
    expect(svg).toContain('ERG')
    expect(svg).toContain('SIM')
  })

  test('ERG step uses blue color, SIM step uses orange color', () => {
    const plan = [
      { type: 'erg', duration: 5, power: 200 },
      { type: 'sim', segmentName: 'R' },
    ]
    const svg = generateStepDividers(calculateWorkoutMetrics(plan, null))
    expect(svg).toContain('#3b82f6') // blue for ERG
    expect(svg).toContain('#f97316') // orange for SIM
  })
})

// ── calculatePositionFraction ────────────────────────────────────────────────

describe('calculatePositionFraction', () => {
  test('returns 0 for empty metrics', () => {
    const metrics = calculateWorkoutMetrics([], null)
    expect(calculatePositionFraction(metrics, 0, 0, 0, null)).toBe(0)
  })

  test('returns 0 at start of first ERG step', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 10, power: 200 }], null)
    expect(calculatePositionFraction(metrics, 0, 0, 0, null)).toBe(0)
  })

  test('returns 0.5 at midpoint of a single ERG step', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 10, power: 200 }], null)
    // 10 min step = 600 s; midpoint = 300 s
    const frac = calculatePositionFraction(metrics, 0, 300, 0, null)
    expect(frac).toBeCloseTo(0.5, 3)
  })

  test('clamps to 1.0 when step elapsed exceeds step duration', () => {
    const metrics = calculateWorkoutMetrics([{ type: 'erg', duration: 10, power: 200 }], null)
    const frac = calculatePositionFraction(metrics, 0, 9999, 0, null)
    expect(frac).toBe(1)
  })

  test('two ERG steps — second step starts at 0.5 fraction', () => {
    const plan = [
      { type: 'erg', duration: 10, power: 200 },
      { type: 'erg', duration: 10, power: 250 },
    ]
    const metrics = calculateWorkoutMetrics(plan, null)
    const frac = calculatePositionFraction(metrics, 1, 0, 0, null)
    expect(frac).toBeCloseTo(0.5, 3)
  })

  test('SIM step — fraction based on distance traveled', () => {
    const plan = [{ type: 'sim', segmentName: 'R' }]
    const route = { totalDistance: 10000 }
    const metrics = calculateWorkoutMetrics(plan, route)
    // Halfway through the route
    const frac = calculatePositionFraction(metrics, 0, 0, 5000, route)
    expect(frac).toBeCloseTo(0.5, 3)
  })

  test('SIM step — falls back to elapsed time when no route', () => {
    const plan = [{ type: 'sim', segmentName: 'R' }]
    const metrics = calculateWorkoutMetrics(plan, null)
    const { steps } = metrics
    // Half of estimated duration
    const halfDur = steps[0].duration / 2
    const frac = calculatePositionFraction(metrics, 0, halfDur, 0, null)
    expect(frac).toBeCloseTo(0.5, 3)
  })
})
