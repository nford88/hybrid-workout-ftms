import { describe, test, expect } from 'vitest'
import { buildStepSummary, describeCurrentStep } from '../../src/services/workoutService'

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

describe('describeCurrentStep — what the ride HUD shows', () => {
  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const base = {
    step: undefined,
    nextStep: undefined,
    isRunning: true,
    elapsedSecInStep: 0,
    distanceM: 0,
    routeTotalM: 0,
    gradePct: null,
    formatDuration: fmt,
  }

  test('nothing running reads as idle, not as zero', () => {
    // A HUD that shows "0 W, 00:00 left" while stopped looks like a live workout at zero.
    const v = describeCurrentStep({ ...base, isRunning: false })
    expect(v.kind).toBeNull()
    expect(v.targetValue).toBe('—')
    expect(v.progressPct).toBe(0)
  })

  test('a running workout with no step is idle too', () => {
    expect(describeCurrentStep({ ...base, step: undefined }).kind).toBeNull()
  })

  test('ERG steps are bounded by time', () => {
    const v = describeCurrentStep({
      ...base,
      step: { type: 'erg', power: 210, duration: 10 },
      elapsedSecInStep: 134,
    })
    expect(v.kind).toBe('ERG')
    expect(v.targetValue).toBe('210')
    expect(v.targetUnit).toBe('watts')
    expect(v.remaining).toBe('07:46 left')
    expect(v.progressPct).toBeCloseTo((134 / 600) * 100, 5)
  })

  test('ERG progress and remaining both clamp at the end of the step', () => {
    const v = describeCurrentStep({
      ...base,
      step: { type: 'erg', power: 210, duration: 1 },
      elapsedSecInStep: 400,
    })
    expect(v.progressPct).toBe(100)
    expect(v.remaining).toBe('00:00 left')
  })

  test('SIM steps are bounded by route distance, not time', () => {
    const v = describeCurrentStep({
      ...base,
      step: { type: 'sim', segmentName: 'Richmond climb' },
      elapsedSecInStep: 9999,
      distanceM: 3200,
      routeTotalM: 8000,
      gradePct: 3.24,
    })
    expect(v.kind).toBe('SIM')
    expect(v.label).toBe('Richmond climb')
    expect(v.targetValue).toBe('+3.2')
    expect(v.targetUnit).toBe('% gradient')
    expect(v.remaining).toBe('4.8 km left')
    expect(v.progressPct).toBeCloseTo(40, 5)
  })

  test('a negative gradient keeps its sign and gains no plus', () => {
    const v = describeCurrentStep({
      ...base,
      step: { type: 'sim', segmentName: 'descent' },
      gradePct: -4.2,
      routeTotalM: 100,
    })
    expect(v.targetValue).toBe('-4.2')
  })

  test('a SIM step with no grade yet shows a dash, never a misleading 0.0', () => {
    // Telemetry can arrive before the first grade decision of a step.
    const v = describeCurrentStep({
      ...base,
      step: { type: 'sim', segmentName: 'x' },
      gradePct: null,
      routeTotalM: 100,
    })
    expect(v.targetValue).toBe('—')
  })

  test('a SIM step with no route length does not divide by zero', () => {
    const v = describeCurrentStep({
      ...base,
      step: { type: 'sim', segmentName: 'x' },
      distanceM: 500,
      routeTotalM: 0,
      gradePct: 1,
    })
    expect(v.progressPct).toBe(0)
    expect(v.remaining).toBe('—')
  })

  test('the next step is previewed so the rider can prepare rather than react', () => {
    expect(
      describeCurrentStep({
        ...base,
        step: { type: 'erg', power: 100, duration: 5 },
        nextStep: { type: 'sim', segmentName: 'Leap Lane Hills' },
      }).next
    ).toBe('SIM Leap Lane Hills')

    expect(
      describeCurrentStep({
        ...base,
        step: { type: 'sim', segmentName: 'x' },
        nextStep: { type: 'erg', power: 250, duration: 3 },
        routeTotalM: 10,
      }).next
    ).toBe('ERG 250 W')
  })

  test('the last step previews nothing rather than inventing one', () => {
    expect(
      describeCurrentStep({ ...base, step: { type: 'erg', power: 100, duration: 5 } }).next
    ).toBe('')
  })
})
