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

/**
 * A gap longer than this means the device stopped talking, not that the rider stopped pressing.
 *
 * The primary streams battery every ~5 s unprompted, so silence beyond ~8 s is the device going
 * quiet. Kept generous so a missed battery frame does not cry wolf mid-ride.
 */
export const FRAME_STARVATION_MS = 8000

/** How long to wait before reconnecting after a drop. Short: the device is usually ready at once. */
export const RECONNECT_DELAY_MS = 600

/**
 * Cap on unattended reconnects, so a device that is off or out of range cannot spin forever.
 * At ~78 s per link that is well over an hour of riding, which covers any protocol we run.
 */
export const MAX_RECONNECTS = 60

export interface ClickHandlers {
  onButtons: (bitmap: number) => void
  onBattery?: (level: number) => void
  onDisconnected?: () => void
  /** Fired when the link works but publishes nothing — i.e. this is the secondary unit. */
  onSilent?: () => void
  /**
   * Fired when frames STOP arriving on a link that never disconnected, with the ms since connect.
   * The elapsed value is what separates a time-based cutoff from BLE contention.
   */
  onStarved?: (msSinceConnect: number) => void
  /** Fired after an automatic reconnect succeeds, with the attempt number. */
  onReconnected?: (attempt: number) => void
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

  /**
   * Frame watchdog — turns "the paddles just stopped" into a timestamped log line.
   *
   * Every Click failure on 2026-08-06 looked identical from outside: a burst of working buttons,
   * then silence, with NO `gattserverdisconnected` and so no disconnect log. Nothing recorded when
   * the frames stopped or how long the link had been up, which is why "dies at workout start",
   * "dies when the trainer connects" and "dies ~60 s after connecting" could not be separated —
   * they are confounded in every log we have, because the trainer is always connected within the
   * first minute.
   *
   * `elapsed` on every line is the discriminator: a time-based cutoff lands at the same elapsed
   * value regardless of what else happened, a contention-based one does not.
   */
  let connectedAt = Date.now()
  const elapsed = () => `${((Date.now() - connectedAt) / 1000).toFixed(1)}s`
  let lastFrameAt = Date.now()
  let starving = false
  let watchdog: ReturnType<typeof setInterval> | undefined

  let closed = false // set by disconnect(), to stop the reconnect loop
  let reconnects = 0
  let async_: BluetoothRemoteGATTCharacteristic | undefined

  /**
   * AUTO-RECONNECT.
   *
   * Measured on hardware 2026-08-06: frames stop at ~70 s and the host tears the link down at
   * 78.4 s — a supervision timeout, i.e. the device stops answering. That matches the 44-90 s drop
   * family documented since July (H16/H28/H29) and it is NOT the secondary unit's 60.5-61.2 s hard
   * timer. The root cause is still open, and one remaining candidate is closed to us entirely:
   * Zwift subscribes with CCCD 0x0003 (notify AND indicate) on 0002/0004, which Web Bluetooth
   * cannot express — `startNotifications()` picks one from the characteristic's properties.
   *
   * So rather than block on the cause, reconnect. `requestDevice` needs a user gesture but
   * `device.gatt.connect()` on an ALREADY-PERMITTED device does not, so this can run unattended
   * mid-ride. A 27-minute protocol becomes usable with brief gaps instead of dying at 78 s.
   */
  const onGattDisconnected = () => {
    if (probe) clearTimeout(probe)
    if (watchdog) clearInterval(watchdog)
    log(`GATT disconnected after ${elapsed()}`)
    handlers.onDisconnected?.()
    if (closed) return
    if (reconnects >= MAX_RECONNECTS) {
      log(`giving up after ${MAX_RECONNECTS} reconnects — press Reconnect to try again`)
      return
    }
    reconnects += 1
    const attempt = reconnects
    setTimeout(() => {
      if (closed) return
      log(`reconnect attempt ${attempt}/${MAX_RECONNECTS}…`)
      attach()
        .then(() => {
          log(`reconnected on attempt ${attempt}`)
          handlers.onReconnected?.(attempt)
        })
        .catch((e) => log(`reconnect ${attempt} failed: ${e?.message ?? e}`))
    }, RECONNECT_DELAY_MS)
  }
  device.addEventListener('gattserverdisconnected', onGattDisconnected)

  const onAsync = (e: Event) => {
    const ch = e.target as BluetoothRemoteGATTCharacteristic
    if (!ch.value) return
    const frame = parseClickFrame(toBytes(ch.value))
    if (!frame) return
    sawFrame = true
    lastFrameAt = Date.now()
    if (starving) {
      starving = false
      log(`frames RESUMED at ${elapsed()} — the link recovered on its own`)
    }
    if (frame.type === 'buttons') handlers.onButtons(frame.bitmap)
    else if (frame.type === 'battery') handlers.onBattery?.(frame.level)
  }

  /**
   * Connect, discover, subscribe, handshake. Re-runnable, because a reconnect must redo ALL of it:
   * a fresh GATT link invalidates the old characteristic objects and their subscriptions.
   */
  async function attach(): Promise<void> {
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

    async_ = await service.getCharacteristic(ZAP_ASYNC)
    const syncTx = await service.getCharacteristic(ZAP_SYNC_TX)
    const syncRx = await service.getCharacteristic(ZAP_SYNC_RX)

    // SUBSCRIBE BEFORE THE HANDSHAKE — the reply lands on SYNC TX as an indication, and a
    // subscription made afterwards misses it.
    async_.addEventListener('characteristicvaluechanged', onAsync)
    await async_.startNotifications()
    await syncTx.startNotifications()
    log('subscribed to ASYNC + SYNC TX')

    await syncRx.writeValueWithoutResponse(RIDE_ON)
    log('handshake written (RideOn 02 03)')

    // Reset the liveness clocks so the watchdog measures THIS link, not the previous one.
    connectedAt = Date.now()
    lastFrameAt = Date.now()
    starving = false
    sawFrame = false
    startTimers()
  }

  await attach()

  // Silence here means the secondary unit. Surfacing it in seconds beats letting the user
  // discover it when the link dies a minute later.
  function startTimers() {
    if (probe) clearTimeout(probe)
    if (watchdog) clearInterval(watchdog)
    probe = setTimeout(() => {
      if (!sawFrame) {
        log('no frames after handshake — this is the pair’s secondary unit')
        handlers.onSilent?.()
      }
    }, PRIMARY_PROBE_MS)

    // The primary streams battery every ~5 s even when nothing is pressed, so a gap this long means
    // the device has stopped talking rather than the rider having stopped pressing.
    watchdog = setInterval(() => {
      const quiet = Date.now() - lastFrameAt
      if (!starving && sawFrame && quiet > FRAME_STARVATION_MS) {
        starving = true
        log(
          `NO FRAMES for ${(quiet / 1000).toFixed(1)}s (link still connected, elapsed ${elapsed()}) ` +
            `— the device has gone quiet without disconnecting`
        )
        handlers.onStarved?.(Date.now() - connectedAt)
      }
    }, 1000)
  }

  return {
    deviceId: device.id,
    deviceName: device.name ?? 'Zwift Click',
    disconnect() {
      closed = true
      if (probe) clearTimeout(probe)
      if (watchdog) clearInterval(watchdog)
      async_?.removeEventListener('characteristicvaluechanged', onAsync)
      device.removeEventListener('gattserverdisconnected', onGattDisconnected)
      device.gatt?.disconnect()
    },
  }
}
