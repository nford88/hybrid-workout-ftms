/**
 * workoutService.ts — Pure workout calculation functions.
 *
 * No DOM, no global state, no side-effects. All inputs are explicit parameters.
 */

import type { WorkoutStep, WorkoutState, StepSummary, WorkoutSummary } from '../types.js'

// ── ERG step ──────────────────────────────────────────────────────────────────

/**
 * Estimate distance traveled during an ERG step based on speed.
 */
export function calculateErgDistance(stepStartTime: number, speedKph: number, now: number): number {
  const durationSec = (now - stepStartTime) / 1000
  return (speedKph / 3.6) * durationSec
}

/**
 * Calculate ERG step progress as a percentage (0–100), floored to seconds.
 */
export function calculateErgProgress(
  stepStartTime: number,
  durationMinutes: number,
  now: number
): number {
  const elapsedSec = Math.floor((now - stepStartTime) / 1000)
  const durationSec = durationMinutes * 60
  return Math.min(100, (elapsedSec / durationSec) * 100)
}

// ── Ride HUD: what the current step is doing ───────────────────────────────────

export interface StepView {
  /** 'ERG' | 'SIM' | null when nothing is running. */
  kind: 'ERG' | 'SIM' | null
  /** Segment name for SIM, a duration for ERG, '' when idle. */
  label: string
  /** The number the rider is being asked to hit, already formatted. */
  targetValue: string
  targetUnit: string
  /** How much of this step is left, as a phrase — time for ERG, distance for SIM. */
  remaining: string
  /** 0–100. */
  progressPct: number
  /** A one-line preview of the next step, or '' when this is the last one. */
  next: string
}

const IDLE_STEP_VIEW: StepView = {
  kind: null,
  label: '',
  targetValue: '—',
  targetUnit: '',
  remaining: '—',
  progressPct: 0,
  next: '',
}

function stepPreview(step: WorkoutStep | undefined): string {
  if (!step) return ''
  return step.type === 'erg' ? `ERG ${step.power} W` : `SIM ${step.segmentName}`
}

/**
 * Derive everything the ride HUD shows about the current step, as formatted strings.
 *
 * Pure and separate from the components so it can be tested without a DOM, and so the ERG and
 * SIM branches — which measure progress in completely different units — are decided in one
 * place rather than in JSX. ERG steps are bounded by TIME; SIM steps are bounded by ROUTE
 * DISTANCE and have no meaningful time remaining, which is why `remaining` is a phrase rather
 * than a number of seconds.
 *
 * `gradePct` is the grade the app is COMMANDING at the current route position, not anything the
 * trainer reports back — that distinction is load-bearing everywhere else in this project and
 * the HUD label should not blur it.
 */
export function describeCurrentStep(input: {
  step: WorkoutStep | undefined
  nextStep: WorkoutStep | undefined
  isRunning: boolean
  elapsedSecInStep: number
  distanceM: number
  routeTotalM: number
  gradePct: number | null
  formatDuration: (seconds: number) => string
}): StepView {
  const {
    step,
    nextStep,
    isRunning,
    elapsedSecInStep,
    distanceM,
    routeTotalM,
    gradePct,
    formatDuration,
  } = input

  if (!isRunning || !step) return IDLE_STEP_VIEW

  if (step.type === 'erg') {
    const totalSec = step.duration * 60
    const leftSec = Math.max(0, Math.round(totalSec - elapsedSecInStep))
    return {
      kind: 'ERG',
      label: `${step.duration} min`,
      targetValue: String(step.power),
      targetUnit: 'watts',
      remaining: `${formatDuration(leftSec)} left`,
      progressPct: totalSec > 0 ? Math.min(100, (elapsedSecInStep / totalSec) * 100) : 0,
      next: stepPreview(nextStep),
    }
  }

  const leftM = routeTotalM > 0 ? Math.max(0, routeTotalM - distanceM) : null
  return {
    kind: 'SIM',
    label: step.segmentName,
    // A SIM step with no grade yet is normal: the first telemetry sample can land before the
    // first grade decision. Say so with a dash rather than printing a misleading 0.0%.
    targetValue: gradePct === null ? '—' : `${gradePct > 0 ? '+' : ''}${gradePct.toFixed(1)}`,
    targetUnit: '% gradient',
    remaining: leftM === null ? '—' : `${(leftM / 1000).toFixed(1)} km left`,
    progressPct: routeTotalM > 0 ? Math.min(100, (distanceM / routeTotalM) * 100) : 0,
    next: stepPreview(nextStep),
  }
}

// ── Step summary ──────────────────────────────────────────────────────────────

/**
 * Build a step summary record from current workout state.
 * Does NOT mutate anything — caller is responsible for pushing to stepSummary[].
 */
export function buildStepSummary(
  step: WorkoutStep,
  stepIndex: number,
  workoutState: WorkoutState,
  speedKph: number,
  now: number
): StepSummary {
  const W = workoutState
  const durationSec = (now - W.stepStartTime) / 1000
  // ERG distance prefers the continuously-integrated figure. The old
  // `calculateErgDistance` extrapolates the FINAL instantaneous speed across the whole
  // step, which recorded 0.00 km for a genuinely-ridden 2.20 km on 2026-07-29 simply
  // because the rider stopped pedalling as the step ended. Kept as a fallback for steps
  // that began before the integrator existed.
  const rawDistance =
    step.type === 'sim'
      ? W.stepSimDistance || 0
      : (W.stepIntegratedDistance ?? calculateErgDistance(W.stepStartTime, speedKph, now))
  const distance = Math.max(0, rawDistance)

  return {
    stepNumber: stepIndex + 1,
    type: step.type,
    plannedDuration: step.type === 'erg' && step.duration ? step.duration * 60 : null, // seconds
    actualDuration: durationSec,
    distance,
    averageSpeed: distance > 0 ? (distance / durationSec) * 3.6 : 0, // kph
    target: step.type === 'erg' ? `${step.power}W` : 'Route Grade',
    segmentName: step.type === 'sim' ? step.segmentName : null,
    routeDistance: step.type === 'sim' ? W.simDistanceTraveled || 0 : null,
    routeCompleted: step.type === 'sim' ? W.routeCompleted || false : null,
  }
}

// ── Workout summary ───────────────────────────────────────────────────────────

/**
 * Compute totals across all completed steps.
 */
export function buildWorkoutSummary(
  stepSummaries: StepSummary[],
  workoutStartTime: number,
  now: number
): WorkoutSummary {
  const totalTime = (now - workoutStartTime) / 1000
  const totalDistance = stepSummaries.reduce((sum, s) => sum + s.distance, 0)
  const averageSpeed = totalDistance > 0 ? (totalDistance / totalTime) * 3.6 : 0

  return {
    totalTime,
    totalDistance,
    averageSpeed,
    steps: stepSummaries,
    timestamp: now, // ms epoch; use new Date(timestamp).toISOString() to format
  }
}
