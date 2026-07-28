import { describe, test, expect } from 'vitest'
import { encodeSimParams, decodeSimParams } from '../../src/dev/protocols/ftmsSim'

describe('encodeSimParams', () => {
  test('encodes Zwift-observed Crr/Cw bytes (0.0051 -> 51, 0.41 -> 41)', () => {
    // docs/virtual-shifting/PROTOCOLS.md §3.2: "Zwift observed sending Crr byte 51
    // (0.0051), Cw byte 41 (0.41)" — CONFIRMED external observation (ftmsemu.github.io).
    const bytes = encodeSimParams({ gradePct: 0, crr: 0.0051, cw: 0.41 })
    expect(bytes[5]).toBe(51)
    expect(bytes[6]).toBe(41)
  })

  test('opcode byte is 0x11', () => {
    expect(encodeSimParams({})[0]).toBe(0x11)
  })

  test('encodes wind speed at spec-correct 0.001 m/s resolution', () => {
    const bytes = encodeSimParams({ windMps: 1.0 })
    // 1.0 / 0.001 = 1000 -> little-endian s16
    expect(bytes[1]).toBe(1000 & 0xff)
    expect(bytes[2]).toBe((1000 >> 8) & 0xff)
  })

  test('encodes negative grade (descent) as two’s-complement s16', () => {
    const bytes = encodeSimParams({ gradePct: -5 })
    const decoded = decodeSimParams(bytes)
    expect(decoded.gradePct).toBeCloseTo(-5, 5)
  })
})

describe('decodeSimParams', () => {
  test('round-trips encodeSimParams for a representative payload', () => {
    const original = { windMps: -0.5, gradePct: 4.25, crr: 0.003, cw: 0.45 }
    const decoded = decodeSimParams(encodeSimParams(original))
    expect(decoded.windMps).toBeCloseTo(original.windMps, 3)
    expect(decoded.gradePct).toBeCloseTo(original.gradePct, 2)
    expect(decoded.crr).toBeCloseTo(original.crr, 4)
    expect(decoded.cw).toBeCloseTo(original.cw, 2)
  })

  test('decodes a hand-built buffer matching the Zwift-observed Crr/Cw bytes', () => {
    // opcode 0x11, wind=0, grade=0, crr byte 51, cw byte 41
    const decoded = decodeSimParams([0x11, 0x00, 0x00, 0x00, 0x00, 51, 41])
    expect(decoded.crr).toBeCloseTo(0.0051, 4)
    expect(decoded.cw).toBeCloseTo(0.41, 2)
  })
})
