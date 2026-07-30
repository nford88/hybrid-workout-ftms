/**
 * Live virtual-gear state: which gear is selected, and the grade to send for it.
 *
 * Sits between the pure model (virtualDrivetrain.ts) and the legacy SIM pipeline in
 * src/js/main.js. Deliberately a small singleton rather than another `window.Hybrid` module —
 * the legacy layer reads it, but the logic and state live here, typed and testable.
 */

import {
  ZWIFT_GEAR_RATIOS,
  DEFAULT_WHEEL_CIRCUMFERENCE_M,
  computeSendGrade,
  inferPhysicalRatio,
  drivetrainRatio,
  nearestGearIndex,
  virtualSpeed,
  virtualDistanceM,
  shiftGear,
  type DrivetrainResult,
} from './virtualDrivetrain'
import {
  resolvePhysicsConstants,
  DEFAULT_RIDER_WEIGHT_KG,
  DEFAULT_BIKE_WEIGHT_KG,
} from './riderPhysics'
import { loadRiderPhysicsSettings, loadDrivetrain } from './storage'

export interface GearTelemetry {
  cadenceRpm: number
  speedKph: number
}

export interface VirtualGearSnapshot {
  /** What the trainer reports, kept only for comparison — NOT an input to the solve. */
  trainerSpeedKph: number
  gearIndex: number
  gearRatio: number
  physicalRatio: number
  physicalRatioInferred: boolean
  /** What the telemetry implies the ratio is — a diagnostic, not an input. */
  inferredRatio: number | null
  chainringTeeth: number
  cogTeeth: number
  wheelCircumferenceM: number
  gearTable: readonly number[]
  atLimit: boolean
  last: DrivetrainResult | null
}

const ratios: readonly number[] = ZWIFT_GEAR_RATIOS

// The physical ratio is CONFIGURED, not guessed: with a Zwift Cog it is simply
// chainring/cog and cannot change mid-ride. Inference is kept only as a cross-check.
let drivetrain = loadDrivetrain()
let physicalRatio = drivetrainRatio(drivetrain)
let gearIndex = nearestGearIndex(physicalRatio, ratios)
let physicalRatioInferred = false
let inferredRatio: number | null = null
let atLimit = false
let last: DrivetrainResult | null = null
let telemetry: GearTelemetry = { cadenceRpm: 0, speedKph: 0 }
const listeners = new Set<(s: VirtualGearSnapshot) => void>()

function snapshot(): VirtualGearSnapshot {
  return {
    gearIndex,
    gearRatio: ratios[gearIndex],
    trainerSpeedKph: telemetry.speedKph,
    physicalRatio,
    physicalRatioInferred,
    inferredRatio,
    chainringTeeth: drivetrain.chainringTeeth,
    cogTeeth: drivetrain.cogTeeth,
    wheelCircumferenceM: DEFAULT_WHEEL_CIRCUMFERENCE_M,
    gearTable: ratios,
    atLimit,
    last,
  }
}

function emit() {
  const s = snapshot()
  for (const fn of listeners) fn(s)
}

export function subscribeVirtualGear(fn: (s: VirtualGearSnapshot) => void): () => void {
  listeners.add(fn)
  fn(snapshot())
  return () => listeners.delete(fn)
}

export function getVirtualGear(): VirtualGearSnapshot {
  return snapshot()
}

/**
 * Feed live Indoor Bike Data. Also opportunistically learns the rider's PHYSICAL ratio, which
 * the baseline-identity property depends on — the design's illustrative 2.40 default was found
 * not to match this rider (real ≈1.85, `U16`), and guessing it wrong inflates target power
 * through the aero term. Only learned while genuinely pedalling.
 */
export function updateTelemetry(next: GearTelemetry): void {
  telemetry = next
  // Cross-check only. Back-solving speed/cadence does NOT recover the drivetrain ratio when
  // the trainer derives its speed from power rather than from flywheel revolutions — which
  // is why this bike's nominal 34/14 = 2.43 back-solves to ~1.85 (U16). Using the inferred
  // number as the baseline would silently mis-scale every gear, so it is surfaced for
  // comparison and nothing more.
  const inferred = inferPhysicalRatio(next.cadenceRpm, next.speedKph / 3.6)
  if (inferred && inferred > 0.5 && inferred < 6) inferredRatio = inferred
}

/** Re-read the configured drivetrain — call after the user edits chainring/cog. */
export function reloadDrivetrain(): VirtualGearSnapshot {
  drivetrain = loadDrivetrain()
  physicalRatio = drivetrainRatio(drivetrain)
  gearIndex = nearestGearIndex(physicalRatio, ratios)
  emit()
  return snapshot()
}

export function shiftUp(): VirtualGearSnapshot {
  const r = shiftGear(gearIndex, 1, ratios)
  gearIndex = r.index
  atLimit = r.atLimit
  emit()
  return snapshot()
}

export function shiftDown(): VirtualGearSnapshot {
  const r = shiftGear(gearIndex, -1, ratios)
  gearIndex = r.index
  atLimit = r.atLimit
  emit()
  return snapshot()
}

export function setGearIndex(index: number): VirtualGearSnapshot {
  gearIndex = Math.max(0, Math.min(ratios.length - 1, Math.round(index)))
  emit()
  return snapshot()
}

/** Reset learned state — used when the trainer reconnects or the bike's gear changes. */
export function resetVirtualGear(): void {
  drivetrain = loadDrivetrain()
  physicalRatio = drivetrainRatio(drivetrain)
  gearIndex = nearestGearIndex(physicalRatio, ratios)
  physicalRatioInferred = false
  inferredRatio = null
  atLimit = false
  last = null
  emit()
}

/**
 * The grade to actually send the trainer for `routeGradePct` in the current gear.
 *
 * Returns the route grade unchanged when we have no usable telemetry, so a missing cadence
 * feed degrades to plain SIM rather than to nonsense.
 */
export function sendGradeFor(routeGradePct: number): number {
  const physics = resolvePhysicsConstants(loadRiderPhysicsSettings())
  const stored = loadRiderPhysicsSettings()
  const massKg =
    (stored.riderWeightKg ?? DEFAULT_RIDER_WEIGHT_KG) +
    (stored.bikeWeightKg ?? DEFAULT_BIKE_WEIGHT_KG)

  // Flywheel speed is derived from CADENCE, not from the trainer's reported speed.
  //
  // The trainer is set to auto-calculate speed, so what it reports is the output of its own
  // road-model simulation — and that model's input is the grade WE send it. Feeding it back
  // into our solve closes a loop: a steeper grade slows its simulated speed, `P_target/v_fly`
  // rises, we solve for a steeper grade still. Whenever the rider produces less than target
  // (120 W asked, 100 W actual on the 2026-07-29 ride) that loop has no fixed point and walks
  // toward the clamp.
  //
  // Cadence is a real measurement, and for a fixed drivetrain — a Zwift Cog especially, where
  // the ratio cannot change mid-ride — cadence x ratio x circumference IS the flywheel speed.
  // Using it makes the solve open-loop and predictable.
  const flywheelSpeedMs = virtualSpeed(
    telemetry.cadenceRpm,
    physicalRatio,
    DEFAULT_WHEEL_CIRCUMFERENCE_M
  )

  last = computeSendGrade({
    gradePct: routeGradePct,
    cadenceRpm: telemetry.cadenceRpm,
    flywheelSpeedMs,
    gearRatio: ratios[gearIndex],
    physicalRatio,
    massKg,
    crr: physics.crr,
    cw: physics.cw,
    wheelCircumferenceM: DEFAULT_WHEEL_CIRCUMFERENCE_M,
  })
  emit()
  return last.sendGradePct
}

/**
 * Distance to add for `dtSeconds`, in metres, using the model's VIRTUAL speed.
 *
 * The SIM loop previously integrated the trainer's reported speed, which is derived from the
 * grade we send — so a harder gear produced a steeper sent grade, a lower reported speed and
 * LESS distance. Exactly backwards. Returns null while coasting or before the first
 * computation, so the caller can fall back to trainer speed rather than freezing.
 */
export function virtualDistanceFor(dtSeconds: number): number | null {
  if (!last || last.coasting) return null
  return virtualDistanceM(last.virtualSpeedMs, dtSeconds)
}

/** The speed to DISPLAY, kph — the virtual speed, or null while coasting. */
export function virtualSpeedKph(): number | null {
  if (!last || last.coasting) return null
  return last.virtualSpeedMs * 3.6
}
