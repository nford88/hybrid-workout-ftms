import { describe, test, expect } from 'vitest'
import {
  ZWIFT_GEAR_RATIOS,
  DEFAULT_GEAR_INDEX,
  DEFAULT_WHEEL_CIRCUMFERENCE_M,
  MAX_SEND_GRADE_PCT,
  virtualSpeed,
  roadPowerW,
  solveSendGrade,
  computeSendGrade,
  baselineIdentityHolds,
  shiftGear,
  clampGearIndex,
  inferPhysicalRatio,
  drivetrainRatio,
  nearestGearIndex,
  virtualDistanceM,
  DEFAULT_DRIVETRAIN,
} from '../../src/services/virtualDrivetrain'

// This rider's real measured values: physical ratio ≈1.85 (U16, back-solved from speed and
// cadence), mass 92 kg, and the trainer's own assumed mass 93.3 kg (HW-V8 regression).
const RIDER = {
  massKg: 92,
  trainerMassKg: 93.3,
  crr: 0.004,
  cw: 0.51,
  physicalRatio: 1.85,
}

describe('virtualDrivetrain — gear table', () => {
  test("matches Zwift's 24 ratios, 0.75 to 5.49", () => {
    expect(ZWIFT_GEAR_RATIOS).toHaveLength(24)
    expect(ZWIFT_GEAR_RATIOS[0]).toBe(0.75)
    expect(ZWIFT_GEAR_RATIOS[23]).toBe(5.49)
    expect(ZWIFT_GEAR_RATIOS[DEFAULT_GEAR_INDEX]).toBe(2.4)
  })

  test('ratios increase monotonically', () => {
    for (let i = 1; i < ZWIFT_GEAR_RATIOS.length; i += 1) {
      expect(ZWIFT_GEAR_RATIOS[i]).toBeGreaterThan(ZWIFT_GEAR_RATIOS[i - 1])
    }
  })

  test('shifting stops at both ends instead of wrapping', () => {
    expect(shiftGear(0, -1).atLimit).toBe(true)
    expect(shiftGear(0, -1).index).toBe(0)
    expect(shiftGear(23, 1).atLimit).toBe(true)
    expect(shiftGear(23, 1).index).toBe(23)
    expect(shiftGear(11, 1)).toEqual({ index: 12, ratio: 2.61, atLimit: false })
  })

  test('clampGearIndex keeps an out-of-range index inside the table', () => {
    expect(clampGearIndex(-5)).toBe(0)
    expect(clampGearIndex(99)).toBe(23)
  })
})

describe('virtualDrivetrain — the baseline identity (the property that removes calibration)', () => {
  test('in the physical gear, the model sends the real grade back unchanged', () => {
    // v_fly is not free: the flywheel speed IS cadence x physical ratio x circumference.
    // Feeding an unrelated speed breaks the identity, correctly — the gear would no longer
    // match the one actually turning the wheel.
    const cadenceRpm = 85
    const flywheelSpeedMs = virtualSpeed(cadenceRpm, RIDER.physicalRatio)
    for (const gradePct of [-8, -2, 0, 1.5, 4, 7, 12]) {
      const holds = baselineIdentityHolds({
        gradePct,
        cadenceRpm,
        flywheelSpeedMs,
        ...RIDER,
        trainerMassKg: RIDER.massKg, // identity requires m_t == m
      })
      expect(`${gradePct}%:${holds}`).toBe(`${gradePct}%:true`)
    }
  })

  test('the identity does NOT hold if the trainer assumes a different mass', () => {
    // Our KICKR assumes 93.3 kg against this rider's 92 kg (HW-V8), so a trim exists for a
    // reason. The gap is small but real, and pretending otherwise would hide R3.
    const cadenceRpm = 85
    const holds = baselineIdentityHolds({
      gradePct: 6,
      cadenceRpm,
      flywheelSpeedMs: virtualSpeed(cadenceRpm, RIDER.physicalRatio),
      ...RIDER, // trainerMassKg 93.3 != massKg 92
    })
    expect(holds).toBe(false)
  })

  test('identity needs the flywheel speed to match the virtual speed', () => {
    // v_fly is what the physical gear actually produces at this cadence
    const cadenceRpm = 90
    const flywheelSpeedMs = virtualSpeed(cadenceRpm, RIDER.physicalRatio)
    const result = computeSendGrade({
      gradePct: 5,
      cadenceRpm,
      flywheelSpeedMs,
      gearRatio: RIDER.physicalRatio,
      ...RIDER,
      trainerMassKg: RIDER.massKg,
    })
    expect(result.sendGradePct).toBeCloseTo(5, 2)
  })
})

describe('virtualDrivetrain — gearing behaviour', () => {
  const base = {
    gradePct: 0,
    cadenceRpm: 90,
    flywheelSpeedMs: virtualSpeed(90, RIDER.physicalRatio),
    ...RIDER,
  }

  test('a harder gear demands more power than an easier one', () => {
    const easy = computeSendGrade({ ...base, gearRatio: 1.53 })
    const hard = computeSendGrade({ ...base, gearRatio: 3.99 })
    expect(hard.targetPowerW).toBeGreaterThan(easy.targetPowerW)
    expect(hard.sendGradePct).toBeGreaterThan(easy.sendGradePct)
  })

  test('works on the FLAT — the multiplier model was dead here', () => {
    // 0% grade: a harder gear must still produce resistance, via the aero term on v_virt.
    const harder = computeSendGrade({ ...base, gradePct: 0, gearRatio: 4.24 })
    expect(harder.sendGradePct).toBeGreaterThan(0.1)
    expect(harder.targetPowerW).toBeGreaterThan(0)
  })

  test('works on a DESCENT — a harder gear adds resistance, not a steeper descent', () => {
    const easy = computeSendGrade({ ...base, gradePct: -5, gearRatio: 1.23 })
    const hard = computeSendGrade({ ...base, gradePct: -5, gearRatio: 4.54 })
    expect(hard.sendGradePct).toBeGreaterThan(easy.sendGradePct)
  })

  test('demand increases with every gear, up to the point the clamp engages', () => {
    const results = ZWIFT_GEAR_RATIOS.map((gearRatio) => computeSendGrade({ ...base, gearRatio }))
    const unclamped = results.filter((r) => !r.clamped)
    expect(unclamped.length).toBeGreaterThan(8) // a useful range, not just a couple of gears
    for (let i = 1; i < unclamped.length; i += 1) {
      expect(unclamped[i].sendGradePct).toBeGreaterThan(unclamped[i - 1].sendGradePct)
    }
    // Target POWER keeps rising even where the sent grade saturates — that is the honest
    // signal that the rider is being under-served, and why `clamped` is surfaced.
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i].targetPowerW).toBeGreaterThan(results[i - 1].targetPowerW)
    }
  })
})

describe('virtualDrivetrain — guards', () => {
  test('coasting by cadence sends the real grade through untouched', () => {
    const r = computeSendGrade({
      gradePct: 6,
      cadenceRpm: 0,
      flywheelSpeedMs: 5,
      gearRatio: 3.99,
      ...RIDER,
    })
    expect(r.coasting).toBe(true)
    expect(r.sendGradePct).toBe(6)
  })

  test('a stopped flywheel cannot divide by zero', () => {
    const r = computeSendGrade({
      gradePct: 6,
      cadenceRpm: 90,
      flywheelSpeedMs: 0,
      gearRatio: 3.99,
      ...RIDER,
    })
    expect(r.coasting).toBe(true)
    expect(Number.isFinite(r.sendGradePct)).toBe(true)
  })

  test('an absurd demand clamps and says so, rather than sending nonsense', () => {
    const r = computeSendGrade({
      gradePct: 20,
      cadenceRpm: 120,
      flywheelSpeedMs: 2.0, // barely turning while the model wants huge power
      gearRatio: 5.49,
      ...RIDER,
    })
    expect(r.clamped).toBe(true)
    expect(Math.abs(r.sendGradePct)).toBeLessThanOrEqual(MAX_SEND_GRADE_PCT)
  })

  test('output is always finite across a wide input sweep', () => {
    for (const gradePct of [-20, 0, 20]) {
      for (const cadenceRpm of [0, 15, 60, 130]) {
        for (const flywheelSpeedMs of [0, 1, 5, 20]) {
          for (const gearRatio of [0.75, 2.4, 5.49]) {
            const r = computeSendGrade({
              gradePct,
              cadenceRpm,
              flywheelSpeedMs,
              gearRatio,
              ...RIDER,
            })
            expect(Number.isFinite(r.sendGradePct)).toBe(true)
            expect(Math.abs(r.sendGradePct)).toBeLessThanOrEqual(MAX_SEND_GRADE_PCT)
          }
        }
      }
    }
  })
})

describe('virtualDrivetrain — physics building blocks', () => {
  test('virtual speed matches the hand calculation', () => {
    // 90 rpm in a 2.40 ratio on a 2.096 m wheel = 1.5 rev/s * 2.4 * 2.096
    expect(virtualSpeed(90, 2.4)).toBeCloseTo(7.5456, 3)
    expect(virtualSpeed(0, 2.4)).toBe(0)
  })

  test('road power rises with grade and with speed', () => {
    const flat = roadPowerW(0, 8, 92, 0.004, 0.51)
    const hill = roadPowerW(6, 8, 92, 0.004, 0.51)
    const faster = roadPowerW(0, 12, 92, 0.004, 0.51)
    expect(hill).toBeGreaterThan(flat)
    expect(faster).toBeGreaterThan(flat)
  })

  test('solving a grade round-trips against the forward calculation', () => {
    const mass = 93.3
    const speed = 8.0
    for (const trueGrade of [-6, -1, 0, 3, 9]) {
      const power = roadPowerW(trueGrade, speed, mass, 0.004, 0.51)
      const { gradePct } = solveSendGrade(power, speed, mass, 0.004, 0.51)
      // The small-angle substitution costs well under the FTMS wire quantisation of 0.01.
      expect(Math.abs(gradePct - trueGrade)).toBeLessThan(0.01)
    }
  })
})

describe('virtualDrivetrain — physical ratio inference', () => {
  test('recovers the ratio the bike is actually in', () => {
    const cadence = 88
    const ratio = 1.85
    const speed = virtualSpeed(cadence, ratio)
    expect(inferPhysicalRatio(cadence, speed)).toBeCloseTo(ratio, 3)
  })

  test('refuses to guess while coasting', () => {
    expect(inferPhysicalRatio(0, 5)).toBeNull()
    expect(inferPhysicalRatio(90, 0)).toBeNull()
  })

  test('this rider is nowhere near the design’s illustrative 2.40 default', () => {
    // U16: assuming 2.40 when the real ratio is ~1.85 inflates target power badly.
    const cadence = 88
    const real = inferPhysicalRatio(cadence, virtualSpeed(cadence, 1.85))
    expect(Math.abs(real - 2.4)).toBeGreaterThan(0.4)
  })
})

describe('virtualDrivetrain — defaults', () => {
  test('wheel circumference default is 700x25c', () => {
    expect(DEFAULT_WHEEL_CIRCUMFERENCE_M).toBe(2.096)
  })
})

describe('virtualDrivetrain — physical drivetrain config (Zwift Cog)', () => {
  test('defaults to this bike: 34t chainring, 14t Zwift Cog', () => {
    expect(DEFAULT_DRIVETRAIN).toEqual({ chainringTeeth: 34, cogTeeth: 14 })
    expect(drivetrainRatio(DEFAULT_DRIVETRAIN)).toBeCloseTo(2.4286, 4)
  })

  test('an arbitrary chainring/cog pair resolves to its ratio', () => {
    expect(drivetrainRatio({ chainringTeeth: 50, cogTeeth: 14 })).toBeCloseTo(3.5714, 4)
    expect(drivetrainRatio({ chainringTeeth: 34, cogTeeth: 17 })).toBe(2)
  })

  test('a zero cog cannot divide by zero', () => {
    expect(Number.isFinite(drivetrainRatio({ chainringTeeth: 34, cogTeeth: 0 }))).toBe(true)
  })

  test('34/14 starts the rider in gear 12 of 24', () => {
    // Table gear 12 is 2.40 against the real 2.4286 — a 1.2% mismatch, the closest available.
    expect(nearestGearIndex(drivetrainRatio(DEFAULT_DRIVETRAIN))).toBe(11)
    expect(ZWIFT_GEAR_RATIOS[11]).toBe(2.4)
  })

  test('the baseline gear is near-neutral on the flat with a 34/14 drivetrain', () => {
    const physicalRatio = drivetrainRatio(DEFAULT_DRIVETRAIN)
    const cadenceRpm = 85
    const r = computeSendGrade({
      gradePct: 0,
      cadenceRpm,
      flywheelSpeedMs: virtualSpeed(cadenceRpm, physicalRatio),
      gearRatio: ZWIFT_GEAR_RATIOS[nearestGearIndex(physicalRatio)],
      physicalRatio,
      massKg: 92,
      trainerMassKg: 92,
      crr: 0.004,
      cw: 0.51,
    })
    // Not exactly zero: table gear 2.40 is marginally easier than the real 2.4286.
    expect(Math.abs(r.sendGradePct)).toBeLessThan(0.25)
  })
})

describe('virtualDrivetrain — virtual distance (a harder gear must cover MORE ground)', () => {
  const physicalRatio = drivetrainRatio(DEFAULT_DRIVETRAIN)
  const cadenceRpm = 85
  const base = {
    gradePct: 0,
    cadenceRpm,
    flywheelSpeedMs: virtualSpeed(cadenceRpm, physicalRatio),
    physicalRatio,
    massKg: 92,
    trainerMassKg: 93.3,
    crr: 0.004,
    cw: 0.51,
  }

  test('distance is speed x time', () => {
    expect(virtualDistanceM(10, 3)).toBe(30)
    expect(virtualDistanceM(0, 5)).toBe(0)
  })

  test('never goes backwards or returns NaN on junk input', () => {
    expect(virtualDistanceM(-5, 10)).toBe(0)
    expect(virtualDistanceM(10, -1)).toBe(0)
    expect(virtualDistanceM(NaN, 1)).toBe(0)
    expect(virtualDistanceM(10, NaN)).toBe(0)
  })

  test('a harder gear covers more distance per second, unlike trainer-reported speed', () => {
    const easy = computeSendGrade({ ...base, gearRatio: 1.53 })
    const hard = computeSendGrade({ ...base, gearRatio: 3.24 })
    const easyM = virtualDistanceM(easy.virtualSpeedMs, 1)
    const hardM = virtualDistanceM(hard.virtualSpeedMs, 1)
    expect(hardM).toBeGreaterThan(easyM)

    // And the sign of the fix: the trainer would have done the OPPOSITE, because the harder
    // gear makes us send a steeper grade, which slows the trainer's own speed model.
    expect(hard.sendGradePct).toBeGreaterThan(easy.sendGradePct)
  })

  test('distance scales with the gear ratio, exactly as cadence x ratio x circumference', () => {
    const r = computeSendGrade({ ...base, gearRatio: 2.4 })
    const expected = (cadenceRpm / 60) * 2.4 * DEFAULT_WHEEL_CIRCUMFERENCE_M
    expect(virtualDistanceM(r.virtualSpeedMs, 1)).toBeCloseTo(expected, 6)
  })
})

describe('the feedback loop the 2026-07-29 ride exposed', () => {
  const rPhys = drivetrainRatio(DEFAULT_DRIVETRAIN)
  const R = { massKg: 92, trainerMassKg: 93.3, crr: 0.017, cw: 0.51, physicalRatio: rPhys }

  test("using the trainer's own reported speed makes the solve diverge", () => {
    // The trainer auto-calculates speed from its road model, whose input is the grade we
    // send. Simulate that loop: each iteration feeds the previous grade's slower speed back
    // in. With the rider under target, it walks to the clamp.
    const cadenceRpm = 85
    const gearRatio = 2.4
    let trainerSpeedMs = virtualSpeed(cadenceRpm, rPhys)
    const grades = []
    for (let i = 0; i < 30; i += 1) {
      const r = computeSendGrade({
        gradePct: 5,
        cadenceRpm,
        flywheelSpeedMs: trainerSpeedMs,
        gearRatio,
        ...R,
      })
      // Only the live phase is interesting: once the simulated speed decays under the
      // coasting threshold the guard correctly hands back the raw route grade.
      if (!r.coasting) grades.push(r.sendGradePct)
      // A steeper grade slows the trainer's simulated speed.
      trainerSpeedMs *= 0.93
    }
    // Monotonic escalation with no fixed point: a real 5% grade is asked for as 4.7%, then
    // 5.8%, 6.9%, ... reaching 18.7% by the 12th iteration and pinning at the clamp after.
    for (let i = 1; i < grades.length; i += 1) {
      expect(grades[i]).toBeGreaterThanOrEqual(grades[i - 1])
    }
    expect(grades[0]).toBeCloseTo(4.72, 1)
    expect(grades[11]).toBeGreaterThan(18)
    expect(grades[grades.length - 1]).toBe(MAX_SEND_GRADE_PCT) // eventually pinned
  })

  test('deriving flywheel speed from CADENCE is stable — the same grade every time', () => {
    const cadenceRpm = 85
    const gearRatio = 2.4
    const grades = []
    for (let i = 0; i < 12; i += 1) {
      // Cadence-derived speed does not depend on what we sent last time.
      const flywheelSpeedMs = virtualSpeed(cadenceRpm, rPhys)
      grades.push(
        computeSendGrade({ gradePct: 5, cadenceRpm, flywheelSpeedMs, gearRatio, ...R }).sendGradePct
      )
    }
    expect(new Set(grades.map((g) => g.toFixed(6))).size).toBe(1)
    expect(grades[0]).toBeLessThan(MAX_SEND_GRADE_PCT)
  })

  test('the baseline identity still holds with cadence-derived speed', () => {
    const cadenceRpm = 85
    expect(
      baselineIdentityHolds({
        gradePct: 5,
        cadenceRpm,
        flywheelSpeedMs: virtualSpeed(cadenceRpm, rPhys),
        ...R,
        trainerMassKg: R.massKg,
      })
    ).toBe(true)
  })
})
