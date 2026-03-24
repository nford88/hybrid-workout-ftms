/**
 * graphService.ts — Pure graph calculation functions.
 *
 * All functions are side-effect free. They receive data as arguments and
 * return SVG strings or plain objects — no DOM access, no global state.
 */

import type {
  WorkoutStep,
  GarminRoute,
  RouteDataPoint,
  GraphConfig,
  WorkoutMetrics,
  GraphStep,
} from '../types.js'

export const GRAPH_CONFIG: GraphConfig = {
  width: 800,
  height: 150,
  paddingLeft: 50,
  paddingRight: 50,
  paddingTop: 15,
  paddingBottom: 10,
  minPower: 0,
  maxPower: 400,
  minGrade: -10,
  maxGrade: 15,
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/**
 * Convert a workout plan + optional route into a metrics object used by all
 * graph rendering functions.
 */
export function calculateWorkoutMetrics(
  plan: WorkoutStep[],
  route: GarminRoute | null
): WorkoutMetrics {
  let totalDuration = 0
  const steps: GraphStep[] = []

  for (const step of plan) {
    if (step.type === 'erg') {
      const durationSec = (step.duration || 0) * 60
      steps.push({
        type: 'erg',
        power: step.power || 0,
        startTime: totalDuration,
        endTime: totalDuration + durationSec,
        duration: durationSec,
      })
      totalDuration += durationSec
    } else if (step.type === 'sim') {
      const routeDistance = route ? route.totalDistance : 5000
      const assumedSpeedKph = 25
      const estimatedDuration = (routeDistance / 1000 / assumedSpeedKph) * 3600
      steps.push({
        type: 'sim',
        segmentName: step.segmentName,
        startTime: totalDuration,
        endTime: totalDuration + estimatedDuration,
        duration: estimatedDuration,
        routeDistance,
      })
      totalDuration += estimatedDuration
    }
  }

  let maxPower = GRAPH_CONFIG.maxPower
  for (const step of steps) {
    if (step.type === 'erg' && step.power > maxPower) {
      maxPower = Math.ceil((step.power + 50) / 50) * 50
    }
  }

  return { totalDuration, steps, maxPower }
}

// ── SVG path generators ───────────────────────────────────────────────────────

/**
 * Generate SVG path markup for ERG steps (blue filled rectangles).
 */
export function generateErgPaths(
  metrics: WorkoutMetrics,
  config: GraphConfig = GRAPH_CONFIG
): string {
  const { totalDuration, steps, maxPower } = metrics
  if (!steps.length || totalDuration === 0) return ''

  const graphWidth = config.width - config.paddingLeft - config.paddingRight
  const graphHeight = config.height - config.paddingTop - config.paddingBottom
  const baseY = config.height - config.paddingBottom

  const timeToX = (t: number) => config.paddingLeft + (t / totalDuration) * graphWidth
  const powerToY = (power: number) => baseY - (power / maxPower) * graphHeight

  let paths = ''
  for (const step of steps) {
    if (step.type !== 'erg') continue
    const x1 = timeToX(step.startTime)
    const x2 = timeToX(step.endTime)
    const y = powerToY(step.power)
    paths += `<path d="M ${x1} ${baseY} L ${x1} ${y} L ${x2} ${y} L ${x2} ${baseY} Z" fill="url(#erg-gradient)" stroke="#3b82f6" stroke-width="2"/>`
  }
  return paths
}

/**
 * Generate SVG path markup for SIM steps (orange gradient profile).
 */
export function generateSimPaths(
  metrics: WorkoutMetrics,
  config: GraphConfig = GRAPH_CONFIG,
  routeData: RouteDataPoint[] | null | undefined,
  getGrade: ((distance: number, routeData: RouteDataPoint[]) => number) | undefined
): string {
  const { totalDuration, steps } = metrics
  if (!steps.length || totalDuration === 0) return ''

  const graphWidth = config.width - config.paddingLeft - config.paddingRight
  const graphHeight = config.height - config.paddingTop - config.paddingBottom
  const zeroY = config.paddingTop + graphHeight / 2
  const gradeRange = config.maxGrade - config.minGrade

  const timeToX = (t: number) => config.paddingLeft + (t / totalDuration) * graphWidth
  const gradeToY = (grade: number) => {
    const clamped = Math.max(config.minGrade, Math.min(config.maxGrade, grade))
    const normalized = (clamped - config.minGrade) / gradeRange
    return config.height - config.paddingBottom - normalized * graphHeight
  }

  let paths = ''
  for (const step of steps) {
    if (step.type !== 'sim') continue

    const x1 = timeToX(step.startTime)
    const x2 = timeToX(step.endTime)
    const stepWidth = x2 - x1

    if (routeData && routeData.length > 1 && getGrade) {
      const routeDistance = step.routeDistance || routeData[routeData.length - 1].distance
      const numSamples = Math.min(100, Math.max(20, routeData.length))
      const pts = [`M ${x1} ${zeroY}`]

      for (let j = 0; j <= numSamples; j++) {
        const sampleDist = (j / numSamples) * routeDistance
        const grade = getGrade(sampleDist, routeData)
        const x = x1 + (j / numSamples) * stepWidth
        pts.push(`L ${x} ${gradeToY(grade)}`)
      }
      pts.push(`L ${x2} ${zeroY}`, 'Z')
      paths += `<path d="${pts.join(' ')}" fill="url(#sim-gradient-up)" stroke="#f97316" stroke-width="1.5"/>`
    } else {
      paths += `<path d="M ${x1} ${zeroY} L ${x1} ${zeroY} L ${x2} ${zeroY} L ${x2} ${zeroY} Z" fill="url(#sim-gradient-up)" stroke="#f97316" stroke-width="1.5"/>`
    }
  }
  return paths
}

/**
 * Generate SVG markup for step divider lines and type labels.
 */
export function generateStepDividers(
  metrics: WorkoutMetrics,
  config: GraphConfig = GRAPH_CONFIG
): string {
  const { totalDuration, steps } = metrics
  if (!steps.length) return ''

  const graphWidth = config.width - config.paddingLeft - config.paddingRight
  const timeToX = (t: number) => config.paddingLeft + (t / totalDuration) * graphWidth

  let out = ''
  const color0 = steps[0].type === 'erg' ? '#3b82f6' : '#f97316'
  out += `<text x="${config.paddingLeft + 5}" y="${config.paddingTop + 10}" fill="${color0}" font-size="10" font-weight="bold">${steps[0].type.toUpperCase()}</text>`

  for (let i = 1; i < steps.length; i++) {
    const x = timeToX(steps[i].startTime)
    const color = steps[i].type === 'erg' ? '#3b82f6' : '#f97316'
    out += `<line x1="${x}" y1="${config.paddingTop}" x2="${x}" y2="${config.height - config.paddingBottom}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="4"/>`
    out += `<text x="${x + 5}" y="${config.paddingTop + 10}" fill="${color}" font-size="10" font-weight="bold">${steps[i].type.toUpperCase()}</text>`
  }
  return out
}

// ── Position marker ───────────────────────────────────────────────────────────

/**
 * Calculate the fractional (0–1) position of the workout progress marker.
 */
export function calculatePositionFraction(
  metrics: WorkoutMetrics,
  currentStepIndex: number,
  stepElapsedSec: number,
  simDistanceTraveled: number,
  garminRoute: GarminRoute | null
): number {
  const { totalDuration, steps } = metrics
  if (!totalDuration || !steps.length) return 0

  let elapsedTime = 0
  for (let i = 0; i < currentStepIndex && i < steps.length; i++) {
    elapsedTime += steps[i].duration
  }

  if (currentStepIndex < steps.length) {
    const step = steps[currentStepIndex]
    if (step.type === 'erg') {
      elapsedTime += Math.min(stepElapsedSec, step.duration)
    } else if (step.type === 'sim') {
      if (garminRoute && garminRoute.totalDistance > 0) {
        const fraction = Math.min(1, (simDistanceTraveled || 0) / garminRoute.totalDistance)
        elapsedTime += fraction * step.duration
      } else {
        elapsedTime += Math.min(stepElapsedSec, step.duration)
      }
    }
  }

  return Math.min(1, elapsedTime / totalDuration)
}
