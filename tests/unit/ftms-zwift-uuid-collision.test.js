import { describe, test, expect, vi, afterEach } from 'vitest'
import { FTMSClient } from '../../src/js/ftms.js'

/**
 * The KICKR and the Zwift Click expose BYTE-IDENTICAL Zwift service and characteristic UUIDs.
 * Subscribing to them on the trainer kills the Click — confirmed on hardware 2026-08-06: every
 * button worked right up to `--- Starting Bluetooth Trainer Connection ---`, then went silent with
 * no disconnect event.
 *
 * These tests pin the UUID collision itself (so nobody "fixes" it by changing a constant and
 * quietly breaking the Click path) and pin that the trainer does NOT touch that service by
 * default. The subscriptions were only ever hex logging for the experiments/13-16 capture work;
 * `zwiftCP` was never written to.
 */

const ZWIFT = {
  service: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  notify: '00000002-19ca-4651-86e5-fa29dcdd09d1',
  write: '00000003-19ca-4651-86e5-fa29dcdd09d1',
  indicate: '00000004-19ca-4651-86e5-fa29dcdd09d1',
}

function fakeServer({ onGetService }) {
  return {
    getPrimaryService: async (uuid) => {
      onGetService(uuid)
      if (uuid === ZWIFT.service) {
        return {
          getCharacteristic: async (u) => ({
            uuid: u,
            startNotifications: async () => {},
            addEventListener: () => {},
          }),
        }
      }
      // The FTMS service: enough shape for connect() to proceed.
      return {
        getCharacteristic: async (u) => ({
          uuid: u,
          startNotifications: async () => {},
          addEventListener: () => {},
          properties: {},
        }),
      }
    },
  }
}

afterEach(() => {
  delete globalThis.window?.FTMS_ZWIFT_PROBE
})

describe('Zwift UUID collision with the Click', () => {
  test('the Click and the trainer really do share every UUID', async () => {
    // If this ever fails, the collision is gone and the default-off behaviour can be revisited.
    const click = await import('../../src/services/clickBle.ts')
    expect(click.ZWIFT_SVC_LEGACY).toBe(ZWIFT.service)
    expect(click.ZAP_ASYNC).toBe(ZWIFT.notify)
    expect(click.ZAP_SYNC_RX).toBe(ZWIFT.write)
    expect(click.ZAP_SYNC_TX).toBe(ZWIFT.indicate)
  })

  test('by default the trainer never asks for the Zwift service', async () => {
    const asked = []
    const client = new FTMSClient()
    client._log = vi.fn()
    client.server = fakeServer({ onGetService: (u) => asked.push(u) })

    await client._discoverZwiftService(false)

    expect(asked).not.toContain(ZWIFT.service)
    expect(client.chars.zwiftRD).toBeUndefined()
    expect(client.chars.zwiftSync).toBeUndefined()
    expect(client.chars.zwiftCP).toBeUndefined()
  })

  test('the probe flag re-enables it, for protocol capture only', async () => {
    const asked = []
    const client = new FTMSClient()
    client._log = vi.fn()
    client.server = fakeServer({ onGetService: (u) => asked.push(u) })

    await client._discoverZwiftService(true)

    expect(asked).toContain(ZWIFT.service)
    expect(client.chars.zwiftRD).toBeDefined()
  })

  test('skipping is logged, so a silent Click is never a mystery again', async () => {
    const client = new FTMSClient()
    client._log = vi.fn()
    client.server = fakeServer({ onGetService: () => {} })
    await client._discoverZwiftService(false)
    const said = client._log.mock.calls.flat().join(' ')
    expect(said).toMatch(/Zwift Click/)
    expect(said).toMatch(/FTMS_ZWIFT_PROBE/)
  })
})
