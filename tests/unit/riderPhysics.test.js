import { describe, test, expect } from 'vitest'
import {
  TIRE_CRR_PRESETS,
  POSITION_CW_PRESETS,
  resolvePhysicsConstants,
  ZWIFT_CRR,
  ZWIFT_CW,
} from '../../src/services/riderPhysics'

describe('resolvePhysicsConstants', () => {
  test('resolves a known tire/position preset pair', () => {
    const result = resolvePhysicsConstants({
      riderWeightKg: 89,
      bikeWeightKg: 8,
      tireType: 'road-worn',
      ridingPosition: 'drops',
    })
    const tire = TIRE_CRR_PRESETS.find((p) => p.id === 'road-worn')
    const position = POSITION_CW_PRESETS.find((p) => p.id === 'drops')
    expect(result.crr).toBe(tire.crr)
    expect(result.cw).toBe(position.cw)
  })

  test('falls back to Zwift defaults when tireType/ridingPosition are null', () => {
    const result = resolvePhysicsConstants({
      riderWeightKg: null,
      bikeWeightKg: null,
      tireType: null,
      ridingPosition: null,
    })
    expect(result.crr).toBe(ZWIFT_CRR)
    expect(result.cw).toBe(ZWIFT_CW)
  })

  test('falls back to Zwift defaults for an unrecognized preset id', () => {
    const result = resolvePhysicsConstants({
      riderWeightKg: 80,
      bikeWeightKg: 8,
      tireType: 'not-a-real-preset',
      ridingPosition: 'also-not-real',
    })
    expect(result.crr).toBe(ZWIFT_CRR)
    expect(result.cw).toBe(ZWIFT_CW)
  })

  test('trainer-default presets reproduce Zwift constants exactly', () => {
    const result = resolvePhysicsConstants({
      riderWeightKg: 75,
      bikeWeightKg: 8,
      tireType: 'trainer-smooth',
      ridingPosition: 'trainer-default',
    })
    expect(result.crr).toBe(ZWIFT_CRR)
    expect(result.cw).toBe(ZWIFT_CW)
  })

  test('every tire preset has a positive, physically plausible Crr', () => {
    for (const p of TIRE_CRR_PRESETS) {
      expect(p.crr).toBeGreaterThan(0)
      expect(p.crr).toBeLessThan(0.05)
    }
  })

  test('every position preset has a positive, physically plausible Cw', () => {
    for (const p of POSITION_CW_PRESETS) {
      expect(p.cw).toBeGreaterThan(0)
      expect(p.cw).toBeLessThan(1)
    }
  })
})
