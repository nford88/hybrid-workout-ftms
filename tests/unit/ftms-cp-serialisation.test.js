import { describe, test, expect, vi, beforeEach } from 'vitest'
import { FTMSClient } from '../../src/js/ftms.js'

/**
 * The 2026-08-05 sweep ride lost 64 of 159 SIM grade writes to
 * `NetworkError: GATT operation already in progress`. Three independent callers write to the
 * FTMS Control Point — the 3 s SIM loop, ERG step transitions, and a shift's forced re-send —
 * and each write is really two (RequestControl, then the payload). Interleaved, they trip
 * Chrome's one-GATT-op-at-a-time rule and cancel each other's pending ACK via "Replaced by new
 * command". The trainer never received 40% of the grades the app believed it had sent, which is
 * invisible from inside the app and silently corrupts any physics experiment.
 */
describe('FTMS control point serialisation', () => {
  let client
  let inFlight
  let maxInFlight
  let order

  beforeEach(() => {
    client = new FTMSClient()
    client._log = vi.fn()
    inFlight = 0
    maxInFlight = 0
    order = []

    // Stand in for the GATT characteristic. Mirrors Chrome's actual behaviour: a second
    // concurrent write is rejected rather than queued.
    client.chars = {
      cp: {
        writeValue: async (payload) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          if (inFlight > 1) {
            inFlight -= 1
            throw new DOMException('GATT operation already in progress.', 'NetworkError')
          }
          order.push(payload[0])
          await new Promise((r) => setTimeout(r, 5))
          inFlight -= 1
          // The trainer's indication arrives after the write; resolve the armed waiter.
          client._pendingAck?.resolve?.(0x01)
        },
        writeValueWithoutResponse: async () => {
          throw new Error('should not be reached when serialised')
        },
      },
    }
  })

  test('concurrent writes never overlap at the GATT layer', async () => {
    await Promise.all([
      client.setSim({ gradePct: 1 }),
      client.setSim({ gradePct: 2 }),
      client.setErgWatts(150),
      client.setSim({ gradePct: 3 }),
    ])
    expect(maxInFlight).toBe(1)
  })

  test('every queued operation actually reaches the trainer', async () => {
    await Promise.all([
      client.setSim({ gradePct: 1 }),
      client.setSim({ gradePct: 2 }),
      client.setSim({ gradePct: 3 }),
    ])
    // Each setSim is RequestControl (0x00) then Sim Params (0x11).
    expect(order.filter((op) => op === 0x11)).toHaveLength(3)
    expect(order.filter((op) => op === 0x00)).toHaveLength(3)
  })

  test('operations run in the order they were requested', async () => {
    const seen = []
    const spy = (label) => () => seen.push(label)
    await Promise.all([
      client.setSim({ gradePct: 1 }).then(spy('first')),
      client.setSim({ gradePct: 2 }).then(spy('second')),
      client.setSim({ gradePct: 3 }).then(spy('third')),
    ])
    expect(seen).toEqual(['first', 'second', 'third'])
  })

  test('a failed write does not wedge the queue for everything after it', async () => {
    let calls = 0
    client.chars.cp.writeValue = async () => {
      calls += 1
      if (calls === 2) throw new Error('transient radio failure')
      await new Promise((r) => setTimeout(r, 1))
      client._pendingAck?.resolve?.(0x01)
    }
    client.chars.cp.writeValueWithoutResponse = async () => {
      throw new Error('fallback also failed')
    }
    const results = await Promise.allSettled([
      client.setSim({ gradePct: 1 }),
      client.setSim({ gradePct: 2 }),
      client.setSim({ gradePct: 3 }),
    ])
    // The chain must keep draining: the last write is attempted regardless of the earlier one.
    expect(results).toHaveLength(3)
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  test('a serialised write still produces a correct payload', async () => {
    const payloads = []
    client.chars.cp.writeValue = async (p) => {
      payloads.push(new Uint8Array(p))
      await new Promise((r) => setTimeout(r, 1))
      client._pendingAck?.resolve?.(0x01)
    }
    await client.setSim({ gradePct: 4.25, crr: 0.011, cwa: 0.3, windMps: 0 })
    const sim = payloads.find((p) => p[0] === 0x11)
    const dv = new DataView(sim.buffer)
    expect(dv.getInt16(3, true)).toBe(425)
    expect(dv.getUint8(5)).toBe(110)
    expect(dv.getUint8(6)).toBe(30)
  })
})
