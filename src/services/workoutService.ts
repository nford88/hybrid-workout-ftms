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
