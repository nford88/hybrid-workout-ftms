import { describe, test, expect, vi, beforeEach } from 'vitest'
import { FTMSClient } from '../../src/js/ftms.js'

describe('FTMSClient.setSim wind-speed encoding', () => {
  let client
  let capturedPayload

  beforeEach(() => {
    client = new FTMSClient()
    capturedPayload = null
    client._writeCpAndWaitAck = vi.fn((_opcode, payload) => {
      capturedPayload = payload
      return Promise.resolve()
    })
    // silence debug logging during the test
    client._log = vi.fn()
  })

  test('encodes wind speed at FTMS-spec 0.001 m/s resolution, not 0.01', async () => {
    await client.setSim({ gradePct: 0, windMps: 1.0 })
    const dv = new DataView(capturedPayload.buffer)
    const windRaw = dv.getInt16(1, true)
    // 1.0 m/s at 0.001 resolution -> 1000, NOT 100 (the pre-fix 0.01 resolution bug)
    expect(windRaw).toBe(1000)
  })

  test('round-trips a fractional wind speed correctly', async () => {
    await client.setSim({ gradePct: 0, windMps: -2.345 })
    const dv = new DataView(capturedPayload.buffer)
    const windRaw = dv.getInt16(1, true)
    expect(windRaw).toBe(-2345)
  })

  test('grade/crr/cwa encoding is unaffected by the wind-speed fix', async () => {
    await client.setSim({ gradePct: 4.25, crr: 0.011, cwa: 0.3, windMps: 0 })
    const dv = new DataView(capturedPayload.buffer)
    expect(dv.getInt16(3, true)).toBe(425) // 4.25% * 100
    expect(dv.getUint8(5)).toBe(110) // 0.011 * 10000
    expect(dv.getUint8(6)).toBe(30) // 0.30 * 100
  })
})
