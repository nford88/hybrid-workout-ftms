import { describe, test, expect } from 'vitest'
import { buildStepSummary } from '../../src/services/workoutService'

describe('ERG distance — the 2026-07-29 regression', () => {
  test('uses the integrated distance, not the final instantaneous speed', () => {
    // The real failure: rider stopped pedalling as the step ended, so speedKph was 0 and a
    // genuinely-ridden 2.20 km was recorded as 0.00 km.
    const start = 1_000_000
    const summary = buildStepSummary(
      { type: 'erg', power: 135, duration: 20 },
      3,
      { stepStartTime: start, stepIntegratedDistance: 2200, stepSummary: [] },
      0, // speed at the instant the step ended
      start + 335_000
    )
    expect(summary.distance).toBeCloseTo(2200, 0)
    expect(summary.averageSpeed).toBeGreaterThan(20)
  })

  test('falls back to extrapolation when no integrated figure exists', () => {
    const start = 1_000_000
    const summary = buildStepSummary(
      { type: 'erg', power: 100, duration: 5 },
      0,
      { stepStartTime: start, stepSummary: [] },
      24.5,
      start + 300_000
    )
    // 24.5 kph for 300 s
    expect(summary.distance).toBeCloseTo((24.5 / 3.6) * 300, 0)
  })

  test('SIM steps still use their own accumulator', () => {
    const start = 1_000_000
    const summary = buildStepSummary(
      { type: 'sim', segmentName: 'Leap Lane Hills' },
      2,
      {
        stepStartTime: start,
        stepSimDistance: 8368,
        stepIntegratedDistance: 10780,
        stepSummary: [],
      },
      19.9,
      start + 1_952_000
    )
    // The virtual distance, NOT the trainer-speed integration.
    expect(summary.distance).toBeCloseTo(8368, 0)
  })
})
