/**
 * Virtual shifting — the virtual-speed drivetrain model.
 *
 * Implements VIRTUAL_SHIFTING_DESIGN.md §4.3. This REPLACES the legacy gradient-multiplier
 * model in ftms.js (`VirtualGear.applyToGradient`), which is dead at 0% grade, inverted on
 * descents, and needs per-gear calibration that cannot be reproduced.
 *
 * The idea: a gear does not scale the grade, it changes the speed you would be travelling at
 * for a given cadence. So compute the power the rider *would* need at that virtual speed, then
 * solve backwards for the grade to send the trainer so its own physics demands exactly that
 * power at the speed the flywheel is actually turning.
 *
 *   v_virt   = (cadence/60) × ratio × wheelCircumference
 *   P_target = F_road(grade, v_virt) × v_virt
 *   G_send   : the grade for which the trainer's model demands P_target at v_fly
 *
 * The property that makes this work without calibration: when the virtual gear equals the
 * rider's actual physical gear and the trainer's assumed mass equals ours, G_send == grade
 * exactly. The default gear is honest for free — see `baselineIdentityHolds`.
 *
 * NOTE ON THE POWER CURVE: this model deliberately does NOT use `CALIBRATION_V1` or any
 * per-gear power curve. §4.3 makes that calibration obsolete; the curve's remaining use is as
 * an independent check (predicted vs measured watts per gear), not as an input.
 */

const G = 9.80665

/**
 * Zwift's own 24-ratio table, 0.75–5.49. Confirmed twice independently: SHIFTR's docs and
 * hardcoded varints in qdomyos-zwift (DESIGN §2 / PROTOCOLS.md). Tables are data — a
 * drivetrain-emulation table can be swapped in without touching the maths.
 */
export const ZWIFT_GEAR_RATIOS = [
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.4, 2.61, 2.82, 3.03, 3.24,
  3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49,
] as const

/** Zwift's own default starting gear (index 11 → ratio 2.40). */
export const DEFAULT_GEAR_INDEX = 11

/** Default wheel circumference in metres (700×25c), per §4.3. */
export const DEFAULT_WHEEL_CIRCUMFERENCE_M = 2.096

/**
 * Below these the model is switched off and the real grade is sent through untouched.
 * Two reasons: P_target/v_fly is a divide-by-zero as the flywheel stops, and coasting with no
 * pedal input should feel like coasting, not like a gear.
 */
export const COASTING_CADENCE_RPM = 15
export const COASTING_SPEED_MS = 1.0

/** Trainer-plausible grade range. Beyond this the trainer clamps anyway. */
export const MAX_SEND_GRADE_PCT = 25

export interface DrivetrainInputs {
  /** Route grade in percent, after simPhysics smoothing. */
  gradePct: number
  /** Rider cadence in rpm, from Indoor Bike Data. */
  cadenceRpm: number
  /** Measured flywheel speed in m/s, from Indoor Bike Data. */
  flywheelSpeedMs: number
  /** Virtual gear ratio currently selected. */
  gearRatio: number
  /** The ratio the bike is physically in — the baseline that makes G_send == grade. */
  physicalRatio: number
  /** Rider + bike mass, kg. */
  massKg: number
  /** Mass the TRAINER assumes. HW-V8 regressed 93.3 kg on our KICKR; defaults to massKg. */
  trainerMassKg?: number
  crr: number
  cw: number
  wheelCircumferenceM?: number
  /** User-facing trim, applied to the solved grade. 1.0 = no trim. */
  trim?: number
}

export interface DrivetrainResult {
  /** The grade to hand to FTMS setSim. */
  sendGradePct: number
  /** Power the model says the rider should be producing, watts. */
  targetPowerW: number
  /** Speed implied by cadence in the virtual gear, m/s. */
  virtualSpeedMs: number
  /** True when the coasting guard bypassed the model. */
  coasting: boolean
  /** True when sendGradePct hit the clamp — the rider feels less than the model demands. */
  clamped: boolean
}

/** Speed you would be doing at this cadence in this gear, m/s. */
export function virtualSpeed(
  cadenceRpm: number,
  gearRatio: number,
  wheelCircumferenceM = DEFAULT_WHEEL_CIRCUMFERENCE_M
): number {
  return (cadenceRpm / 60) * gearRatio * wheelCircumferenceM
}

/**
 * Road load in newtons: gravity + rolling resistance + aero.
 * Exact trig — the small-angle approximation is only used when inverting (see solveSendGrade).
 */
export function roadForceN(
  gradePct: number,
  speedMs: number,
  massKg: number,
  crr: number,
  cw: number
): number {
  const theta = Math.atan(gradePct / 100)
  return massKg * G * (Math.sin(theta) + Math.cos(theta) * crr) + cw * speedMs * speedMs
}

/** Power required to hold `speedMs` on `gradePct`, watts. */
export function roadPowerW(
  gradePct: number,
  speedMs: number,
  massKg: number,
  crr: number,
  cw: number
): number {
  return roadForceN(gradePct, speedMs, massKg, crr, cw) * speedMs
}

/**
 * Invert the trainer's own model: find the grade at which it demands `targetPowerW` from a
 * flywheel turning at `flywheelSpeedMs`.
 *
 * Uses the small-angle substitution cos θ' ≈ 1 in the Crr term only; the returned grade is
 * still exact trig. HYPOTHESES.md §F proves the induced error is
 * `sin θ' = sin θ_true − Crr·(1 − cos θ_true)` — independent of mass, speed and Cw, and under
 * 0.007 percentage points even at 20% grade, which is below the FTMS wire format's own
 * 0.01-point quantisation. So this is not a shortcut worth removing.
 */
export function solveSendGrade(
  targetPowerW: number,
  flywheelSpeedMs: number,
  trainerMassKg: number,
  crr: number,
  cw: number
): { gradePct: number; clamped: boolean } {
  const denominator = trainerMassKg * G
  const sinTheta =
    (targetPowerW / flywheelSpeedMs - cw * flywheelSpeedMs * flywheelSpeedMs - denominator * crr) /
    denominator
  // asin's own domain is ±1; ±0.35 (≈20°) is the physically sensible band and keeps the
  // subsequent tan() away from its asymptote.
  const bounded = Math.max(-0.35, Math.min(0.35, sinTheta))
  const gradePct = 100 * Math.tan(Math.asin(bounded))
  const limited = Math.max(-MAX_SEND_GRADE_PCT, Math.min(MAX_SEND_GRADE_PCT, gradePct))
  return { gradePct: limited, clamped: limited !== gradePct || bounded !== sinTheta }
}

/** The whole model: route grade + gear + telemetry → the grade to send. */
export function computeSendGrade(inputs: DrivetrainInputs): DrivetrainResult {
  const {
    gradePct,
    cadenceRpm,
    flywheelSpeedMs,
    gearRatio,
    massKg,
    crr,
    cw,
    trainerMassKg = massKg,
    wheelCircumferenceM = DEFAULT_WHEEL_CIRCUMFERENCE_M,
    trim = 1,
  } = inputs

  const vVirt = virtualSpeed(cadenceRpm, gearRatio, wheelCircumferenceM)

  // Coasting: send the real grade. Also guards the divide by flywheelSpeedMs below.
  if (cadenceRpm < COASTING_CADENCE_RPM || flywheelSpeedMs < COASTING_SPEED_MS) {
    return {
      sendGradePct: gradePct,
      targetPowerW: 0,
      virtualSpeedMs: vVirt,
      coasting: true,
      clamped: false,
    }
  }

  const targetPowerW = roadPowerW(gradePct, vVirt, massKg, crr, cw)
  const solved = solveSendGrade(targetPowerW, flywheelSpeedMs, trainerMassKg, crr, cw)
  const trimmed = solved.gradePct * trim
  const sendGradePct = Math.max(-MAX_SEND_GRADE_PCT, Math.min(MAX_SEND_GRADE_PCT, trimmed))

  return {
    sendGradePct,
    targetPowerW,
    virtualSpeedMs: vVirt,
    coasting: false,
    clamped: solved.clamped || sendGradePct !== trimmed,
  }
}

/**
 * The design's key correctness property, exposed so tests can assert it directly rather than
 * trusting a comment: in the baseline gear, with the trainer's assumed mass matching ours,
 * the model is a no-op and G_send == the real grade.
 */
export function baselineIdentityHolds(
  inputs: Omit<DrivetrainInputs, 'gearRatio'>,
  tolerancePct = 0.01
): boolean {
  const result = computeSendGrade({ ...inputs, gearRatio: inputs.physicalRatio })
  return Math.abs(result.sendGradePct - inputs.gradePct) <= tolerancePct
}

// ── Gear selection ───────────────────────────────────────────────────────────

export function clampGearIndex(index: number, table: readonly number[] = ZWIFT_GEAR_RATIOS) {
  return Math.max(0, Math.min(table.length - 1, Math.round(index)))
}

export function shiftGear(
  index: number,
  direction: 1 | -1,
  table: readonly number[] = ZWIFT_GEAR_RATIOS
): { index: number; ratio: number; atLimit: boolean } {
  const next = clampGearIndex(index + direction, table)
  return { index: next, ratio: table[next], atLimit: next === index }
}

/**
 * Back-solve the rider's physical ratio from live telemetry.
 *
 * The baseline-identity property needs the ratio the bike is ACTUALLY in, and the design's
 * illustrative default (2.40) was found not to match this rider's real gear — measured ≈1.85
 * (`U16`). Assuming a default silently inflates target power through the aero term, so derive
 * it instead: at steady state, v_fly == (cadence/60) × r_phys × C.
 */
export function inferPhysicalRatio(
  cadenceRpm: number,
  flywheelSpeedMs: number,
  wheelCircumferenceM = DEFAULT_WHEEL_CIRCUMFERENCE_M
): number | null {
  if (cadenceRpm < COASTING_CADENCE_RPM || flywheelSpeedMs < COASTING_SPEED_MS) return null
  return flywheelSpeedMs / ((cadenceRpm / 60) * wheelCircumferenceM)
}

// ── Physical drivetrain configuration ────────────────────────────────────────

/**
 * The gear the bike is physically in. With a Zwift Cog the cassette is replaced by a single
 * cog, so this is just chainring/cog and never changes mid-ride — which is exactly the
 * condition the baseline-identity property needs.
 */
export interface DrivetrainConfig {
  chainringTeeth: number
  cogTeeth: number
}

/** Zwift Cog is a 14t single cog; 34t is this bike's chainring. */
export const DEFAULT_DRIVETRAIN: DrivetrainConfig = { chainringTeeth: 34, cogTeeth: 14 }

export function drivetrainRatio(config: DrivetrainConfig): number {
  if (!config.cogTeeth) return DEFAULT_DRIVETRAIN.chainringTeeth / DEFAULT_DRIVETRAIN.cogTeeth
  return config.chainringTeeth / config.cogTeeth
}

/** The table gear closest to a given ratio — where the rider should start. */
export function nearestGearIndex(
  ratio: number,
  table: readonly number[] = ZWIFT_GEAR_RATIOS
): number {
  let best = 0
  for (let i = 1; i < table.length; i += 1) {
    if (Math.abs(table[i] - ratio) < Math.abs(table[best] - ratio)) best = i
  }
  return best
}

/**
 * Distance covered in `dtSeconds` at the model's VIRTUAL speed.
 *
 * This must not use the trainer's reported speed. The trainer derives its speed from the
 * grade we send it, and we send a steeper grade to create the resistance of a harder gear —
 * so integrating trainer speed makes a harder gear cover LESS ground, which is backwards.
 * A harder gear at the same cadence means you are travelling FASTER. Virtual speed is the
 * physically meaningful figure, and it is what Zwift itself uses in virtual shifting.
 */
export function virtualDistanceM(virtualSpeedMs: number, dtSeconds: number): number {
  if (!Number.isFinite(virtualSpeedMs) || !Number.isFinite(dtSeconds)) return 0
  return Math.max(0, virtualSpeedMs) * Math.max(0, dtSeconds)
}
