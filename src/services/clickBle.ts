/**
 * Zwift Click over Web Bluetooth.
 *
 * Implements docs/virtual-shifting/CLICK-CONNECTION-ORDER.md exactly. Every ordering choice
 * here is load-bearing and was established by capturing the official client:
 *
 *   1. subscribe BEFORE the handshake — the reply is an indication on a characteristic you
 *      must already be listening to;
 *   2. handshake is `RideOn 02 03` (8 bytes), which is what Zwift sends;
 *   3. if nothing arrives within a few seconds, you are on the pair's SECONDARY unit, whose
 *      link publishes nothing and dies at ~61 s. That is a normal branch, not an error.
 *
 * Kept thin: all decoding lives in clickButtons.ts as pure functions. This module only moves
 * bytes and owns the connection lifecycle.
 */

import { parseClickFrame } from './clickButtons'

/** 16-bit Zwift service, post-Jan-2025 firmware. Web Bluetooth accepts the numeric form. */
export const ZWIFT_SVC_FC82 = 0xfc82
export const ZWIFT_SVC_LEGACY = '00000001-19ca-4651-86e5-fa29dcdd09d1'
export const ZAP_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1'
export const ZAP_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'
export const ZAP_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'

/** "RideOn" + 02 03 — the 8 bytes the official client writes (experiments/16 §2). */
export const RIDE_ON = Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x02, 0x03])

/** How long to wait for a frame before concluding we are on the secondary unit. */
export const PRIMARY_PROBE_MS = 4000

export interface ClickHandlers {
  onButtons: (bitmap: number) => void
  onBattery?: (level: number) => void
  onDisconnected?: () => void
  /** Fired when the link works but publishes nothing — i.e. this is the secondary unit. */
  onSilent?: () => void
  onLog?: (message: string) => void
}

export interface ClickConnection {
  deviceId: string
  deviceName: string
  disconnect: () => void
}

function toBytes(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

export async function connectClick(handlers: ClickHandlers): Promise<ClickConnection> {
  if (!isWebBluetoothAvailable()) {
    throw new Error('Web Bluetooth unavailable — use Chrome or Edge (not Firefox or Safari)')
  }
  const log = handlers.onLog ?? (() => {})

  // Both service UUIDs must be declared: which one is advertised depends on firmware
  // (0xFC82 post-Jan-2025, the 19ca UUID before). Anything undeclared throws SecurityError.
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'Zwift Click' }],
    optionalServices: [ZWIFT_SVC_FC82, ZWIFT_SVC_LEGACY, 'battery_service'],
  })

  let sawFrame = false
  let probe: ReturnType<typeof setTimeout> | undefined

  const onGattDisconnected = () => {
    if (probe) clearTimeout(probe)
    handlers.onDisconnected?.()
  }
  device.addEventListener('gattserverdisconnected', onGattDisconnected)

  const server = await device.gatt!.connect()
  log(`connected to ${device.name ?? 'Zwift Click'}`)

  // Probe the new service first, then the legacy one.
  let service: BluetoothRemoteGATTService | undefined
  for (const uuid of [ZWIFT_SVC_FC82, ZWIFT_SVC_LEGACY] as const) {
    try {
      service = await server.getPrimaryService(uuid)
      break
    } catch {
      /* try the next */
    }
  }
  if (!service) {
    device.gatt?.disconnect()
    throw new Error('No Zwift service on this device — is it a Click?')
  }

  const async_ = await service.getCharacteristic(ZAP_ASYNC)
  const syncTx = await service.getCharacteristic(ZAP_SYNC_TX)
  const syncRx = await service.getCharacteristic(ZAP_SYNC_RX)

  const onAsync = (e: Event) => {
    const ch = e.target as BluetoothRemoteGATTCharacteristic
    if (!ch.value) return
    const frame = parseClickFrame(toBytes(ch.value))
    if (!frame) return
    sawFrame = true
    if (frame.type === 'buttons') handlers.onButtons(frame.bitmap)
    else if (frame.type === 'battery') handlers.onBattery?.(frame.level)
  }

  // SUBSCRIBE BEFORE THE HANDSHAKE — the reply lands on SYNC TX as an indication, and a
  // subscription made afterwards misses it.
  async_.addEventListener('characteristicvaluechanged', onAsync)
  await async_.startNotifications()
  await syncTx.startNotifications()
  log('subscribed to ASYNC + SYNC TX')

  await syncRx.writeValueWithoutResponse(RIDE_ON)
  log('handshake written (RideOn 02 03)')

  // Silence here means the secondary unit. Surfacing it in seconds beats letting the user
  // discover it when the link dies a minute later.
  probe = setTimeout(() => {
    if (!sawFrame) {
      log('no frames after handshake — this is the pair’s secondary unit')
      handlers.onSilent?.()
    }
  }, PRIMARY_PROBE_MS)

  return {
    deviceId: device.id,
    deviceName: device.name ?? 'Zwift Click',
    disconnect() {
      if (probe) clearTimeout(probe)
      async_.removeEventListener('characteristicvaluechanged', onAsync)
      device.removeEventListener('gattserverdisconnected', onGattDisconnected)
      device.gatt?.disconnect()
    },
  }
}
