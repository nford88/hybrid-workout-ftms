import { clamp } from '../utils/math.js'
import type { WorkoutState } from '../types.js'

const GRADIENT_RAMP_DISTANCE = 10 // meters between grade updates
const MAX_GRADE_CHANGE_PER_RAMP = 1.5 // % per ramp
const MAX_CHANGE_PER_SECOND = 0.5 // % per second

/**
 * Calculate a smoothed, momentum-adjusted grade percentage.
 * Mutates workoutState in place (currentGrade, targetGrade, lastGradeUpdate, lastGradeDistance).
 */
export function calculateRealisticGrade(
  rawGradePct: number,
  speedKph: number,
  currentDistance: number,
  workoutState: WorkoutState,
  now: number
): number {
  const W = workoutState

  if (W.lastGradeUpdate == null) {
    W.currentGrade = rawGradePct
    W.targetGrade = rawGradePct
    W.lastGradeUpdate = now
    W.lastGradeDistance = currentDistance || 0
    return rawGradePct
  }

  const distanceTraveled = (currentDistance || 0) - (W.lastGradeDistance || 0)

  if (distanceTraveled >= GRADIENT_RAMP_DISTANCE) {
    const gradeDiff = rawGradePct - W.currentGrade!
    const smoothed = clamp(gradeDiff, -MAX_GRADE_CHANGE_PER_RAMP, MAX_GRADE_CHANGE_PER_RAMP)
    W.targetGrade = W.currentGrade! + smoothed
    W.lastGradeDistance = currentDistance
  } else {
    W.targetGrade = W.currentGrade
  }

  const timeSinceUpdate = now - W.lastGradeUpdate
  const justUpdated = distanceTraveled >= GRADIENT_RAMP_DISTANCE
  const maxChange = justUpdated
    ? Math.abs(W.targetGrade! - W.currentGrade!)
    : Math.max(0.1, (timeSinceUpdate / 1000) * MAX_CHANGE_PER_SECOND)

  const actualChange = clamp(W.targetGrade! - W.currentGrade!, -maxChange, maxChange)

  const momentumFactor = Math.min(1.0, speedKph / 12)
  const momentumReduction = 0.25 * momentumFactor

  const newGrade = W.currentGrade! + actualChange
  const momentumAssistedGrade = newGrade * (1 - momentumReduction)
  const finalGrade = Math.max(-2, momentumAssistedGrade)

  W.currentGrade = newGrade
  W.lastGradeUpdate = now

  return finalGrade
}
