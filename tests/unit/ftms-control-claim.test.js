import { describe, test, expect, vi, beforeEach } from 'vitest'
import { FTMSClient } from '../../src/js/ftms.js'

/**
 * FTMS control used to be re-requested before EVERY control-point payload, so each SIM write
 * or ERG change cost two round trips. A rider shifting quickly produced visible pile-ups
 * ("CP queue: waiting behind 3 operation(s)") in the 2026-08-07 workout log, because every
 * gear change forces a grade re-send and therefore a second RequestControl.
 *
 * Control is held for the whole link, so it is claimed once. The catch is that control can be
 * revoked and we cannot observe it happening — that is signalled on Machine Status 0x2ADA,
 * which this client deliberately does not subscribe to — so revocation is recovered from the
 * 0x05 "Control Not Permitted" rejection instead.
 */
describe('FTMS control is claimed once per link', () => {
  let client
  let written
  let resultFor

  beforeEach(() => {
    client = new FTMSClient()
    client._log = vi.fn()
    written = []
    resultFor = () => 0x01

    client.chars = {
      cp: {
        writeValue: async (payload) => {
          const opcode = payload[0]
          written.push(opcode)
          await new Promise((r) => setTimeout(r, 1))
          client._pendingAck?.resolve?.(resultFor(opcode, written))
        },
        writeValueWithoutResponse: async () => {
          throw new Error('should not be reached')
        },
      },
    }
  })

  const countOf = (opcode) => written.filter((o) => o === opcode).length

  test('three SIM writes send RequestControl once, not three times', async () => {
    await client.setSim({ gradePct: 1 })
    await client.setSim({ gradePct: 2 })
    await client.setSim({ gradePct: 3 })

    expect(countOf(0x11)).toBe(3)
    expect(countOf(0x00)).toBe(1)
  })

  test('a mixed ERG + SIM sequence still claims control only once', async () => {
    await client.setErgWatts(100)
    await client.setSim({ gradePct: 1 })
    await client.setErgWatts(150)

    expect(countOf(0x05)).toBe(2)
    expect(countOf(0x11)).toBe(1)
    expect(countOf(0x00)).toBe(1)
  })

  test('a 0x05 rejection re-claims control and retries the payload once', async () => {
    await client.setSim({ gradePct: 1 }) // claims control
    expect(countOf(0x00)).toBe(1)

    // The trainer revokes control silently; the next payload is refused exactly once.
    let refuse = true
    resultFor = (opcode) => {
      if (opcode === 0x11 && refuse) {
        refuse = false
        return 0x05 // Control Not Permitted
      }
      return 0x01
    }

    await expect(client.setSim({ gradePct: 2 })).resolves.not.toThrow()

    expect(countOf(0x00)).toBe(2) // re-requested
    expect(countOf(0x11)).toBe(3) // first, refused attempt, then the retry
  })

  test('a non-0x05 failure is NOT retried and propagates', async () => {
    resultFor = (opcode) => (opcode === 0x11 ? 0x03 : 0x01) // Invalid Parameter

    await expect(client.setSim({ gradePct: 1 })).rejects.toThrow(/0x03/)
    expect(countOf(0x11)).toBe(1) // no retry
  })

  test('disconnect drops the claim, so the next link requests control again', async () => {
    await client.setSim({ gradePct: 1 })
    expect(countOf(0x00)).toBe(1)

    await client.disconnect()
    expect(client._hasControl).toBe(false)

    // Reconnecting restores the characteristic; the claim must be made afresh.
    client.chars = {
      cp: {
        writeValue: async (payload) => {
          written.push(payload[0])
          await new Promise((r) => setTimeout(r, 1))
          client._pendingAck?.resolve?.(0x01)
        },
        writeValueWithoutResponse: async () => {
          throw new Error('should not be reached')
        },
      },
    }

    await client.setSim({ gradePct: 2 })
    expect(countOf(0x00)).toBe(2)
  })
})
