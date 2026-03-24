// ftms.js  —  Web Bluetooth helper for FTMS + (optional) Zwift custom service
// Public API:
//   await ftms.connect({ nameHint?: string, log?: fn });
//   await ftms.disconnect();
//   ftms.on('ibd', handler)            // Indoor Bike Data updates {speedKph, cadenceRpm, powerW, raw}
//   ftms.on('ack', handler)            // { forOpcode, result }  (result 0x01 = success)
//   ftms.on('log', handler)            // string log lines
//   await ftms.setErgWatts(watts);
//   await ftms.setSim({ gradePct, crr=0.004, cwa=0.51, windMps=0 });
//   await ftms.rampSim({ fromPct, toPct, stepPct=1, dwellMs=5000, crr=0.004, cwa=0.51, windMps=0 });
//   const features = await ftms.readFeatures(); // returns {raw:DataView, hex:string}
//
// Notes:
// - Always sends Request Control (0x00) then waits for FTMS CP indication ACK, before each operation.
// - Uses writeValueWithResponse for FTMS Control Point (0x2AD9), as required by spec.
// - Parses FTMS Indoor Bike Data (0x2AD2) for speed/cadence/power (common flags pattern we observed).

// ---------- UUIDs ----------
const UUID = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
  FTMS_FEATURE: '00002acc-0000-1000-8000-00805f9b34fb', // read
  FTMS_IBD: '00002ad2-0000-1000-8000-00805f9b34fb', // notify
  FTMS_TRAINING: '00002ad3-0000-1000-8000-00805f9b34fb', // read/notify (not essential)
  FTMS_CP: '00002ad9-0000-1000-8000-00805f9b34fb', // indicate + write
  FTMS_STATUS: '00002ada-0000-1000-8000-00805f9b34fb', // notify (not essential)
  // Zwift custom service (optional to read RidingData / SyncTX)
  ZWIFT_SERVICE: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_RD: '00000002-19ca-4651-86e5-fa29dcdd09d1', // notify
  ZWIFT_CP: '00000003-19ca-4651-86e5-fa29dcdd09d1', // write w/o response
  ZWIFT_SYNC: '00000004-19ca-4651-86e5-fa29dcdd09d1', // indicate
}

// ---------- small utils ----------
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (buf) =>
  [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')
    .toUpperCase()
const _u16le = (dv, o) => dv.getUint16(o, true)
const _s16le = (dv, o) => dv.getInt16(o, true)

class Emitter {
  constructor() {
    this.map = new Map()
  }
  on(evt, fn) {
    ;(this.map.get(evt) ?? this.map.set(evt, []).get(evt)).push(fn)
    return () => this.off(evt, fn)
  }
  off(evt, fn) {
    const arr = this.map.get(evt)
    if (!arr) return
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }
  emit(evt, data) {
    ;(this.map.get(evt) || []).forEach((fn) => {
      try {
        fn(data)
      } catch (e) {
        console.error(e)
      }
    })
  }
}

// ---------- Core FTMS client ----------
class FTMSClient extends Emitter {
  constructor() {
    super()
    this.device = null
    this.server = null
    this.chars = {}
    this._pendingAck = null // {opcode, resolve, reject, timer}
    this._log = (s) => this.emit('log', s)
  }

  async connect({ nameHint, log } = {}) {
    // If log is provided, use it (either as function or boolean for console logging)
    if (typeof log === 'function') {
      this._log = log
    } else if (log === true) {
      this._log = (s) => {
        console.log(s)
        this.emit('log', s)
      }
    }
    this._log('Requesting Bluetooth device…')

    const options = nameHint
      ? {
          filters: [{ namePrefix: nameHint }],
          optionalServices: [UUID.FTMS_SERVICE, UUID.ZWIFT_SERVICE],
        }
      : {
          filters: [{ services: [UUID.FTMS_SERVICE] }],
          optionalServices: [UUID.FTMS_SERVICE, UUID.ZWIFT_SERVICE],
        }

    this.device = await navigator.bluetooth.requestDevice(options)
    this.device.addEventListener('gattserverdisconnected', () => {
      this._log('[BT] Disconnected')
      this.emit('disconnected')
    })

    this._log(`Connecting to GATT server for ${this.device.name ?? '(no name)'}…`)
    this.server = await this.device.gatt.connect()

    // Get FTMS service & characteristics
    const ftms = await this.server.getPrimaryService(UUID.FTMS_SERVICE)
    const [feature, ibd, cp] = await Promise.all([
      ftms.getCharacteristic(UUID.FTMS_FEATURE),
      ftms.getCharacteristic(UUID.FTMS_IBD),
      ftms.getCharacteristic(UUID.FTMS_CP),
    ])
    this.chars.feature = feature
    this.chars.ibd = ibd
    this.chars.cp = cp

    // Optional chars
    try {
      this.chars.status = await ftms.getCharacteristic(UUID.FTMS_STATUS)
    } catch (_e) {
      /* noop */
    }
    try {
      this.chars.training = await ftms.getCharacteristic(UUID.FTMS_TRAINING)
    } catch (_e) {
      /* noop */
    }

    // Optional Zwift service (not required)
    try {
      const zw = await this.server.getPrimaryService(UUID.ZWIFT_SERVICE)
      try {
        this.chars.zwiftRD = await zw.getCharacteristic(UUID.ZWIFT_RD)
      } catch (_e) {
        /* noop */
      }
      try {
        this.chars.zwiftCP = await zw.getCharacteristic(UUID.ZWIFT_CP)
      } catch (_e) {
        /* noop */
      }
      try {
        this.chars.zwiftSync = await zw.getCharacteristic(UUID.ZWIFT_SYNC)
      } catch (_e) {
        /* noop */
      }
    } catch (_e) {
      /* noop */
    }

    // Subscribe
    await this._subscribeAll()
    this._log('[BT] Connected & subscribed.')
    this.emit('connected', { name: this.device.name, id: this.device.id })
  }

  async disconnect() {
    try {
      if (this._pendingAck?.reject) {
        this._pendingAck.reject(new Error('Disconnected'))
        this._clearPendingAck()
      }
      if (this.device?.gatt.connected) this.device.gatt.disconnect()
    } finally {
      this.device = null
      this.server = null
      this.chars = {}
    }
  }

  async _subscribeAll() {
    // IBD notifications
    if (this.chars.ibd) {
      await this.chars.ibd.startNotifications()
      this.chars.ibd.addEventListener('characteristicvaluechanged', (e) => {
        const dv = e.target.value
        const parsed = this._parseIbd(dv)
        this.emit('ibd', parsed)
      })
      this._log('Subscribed: FTMS Indoor Bike Data (notify).')
    }
    // CP indications (ACKs)
    if (this.chars.cp) {
      await this.chars.cp.startNotifications()
      this.chars.cp.addEventListener('characteristicvaluechanged', (e) =>
        this._onCpIndication(e.target.value)
      )
      this._log('Subscribed: FTMS Control Point (indicate).')
    }
    // Optional: FTMS status / training
    if (this.chars.status) {
      await this.chars.status.startNotifications().catch(() => {})
    }
    if (this.chars.training) {
      await this.chars.training.startNotifications().catch(() => {})
    }
    // Optional Zwift RidingData / SyncTX
    if (this.chars.zwiftRD) {
      await this.chars.zwiftRD.startNotifications().catch(() => {})
      this.chars.zwiftRD.addEventListener('characteristicvaluechanged', (e) => {
        this._log(`NOTIFY ZWIFT RidingData: "${hex(e.target.value.buffer)}"`)
      })
      this._log('Subscribed: Zwift Riding Data (notify).')
    }
    if (this.chars.zwiftSync) {
      await this.chars.zwiftSync.startNotifications().catch(() => {})
      this.chars.zwiftSync.addEventListener('characteristicvaluechanged', (e) => {
        this._log(`IND from Zwift SyncTX: ${hex(e.target.value.buffer)}`)
      })
      this._log('Subscribed: Zwift SyncTX (indicate).')
    }
  }

  // --------- Public ops ---------
  async readFeatures() {
    const v = await this.chars.feature.readValue()
    return { raw: v, hex: hex(v.buffer) }
  }

  async setErgWatts(watts) {
    if (!Number.isFinite(watts) || watts < 0 || watts > 2000) {
      throw new Error('ERG watts must be 0..2000')
    }
    const payload = new Uint8Array([0x05, watts & 0xff, (watts >> 8) & 0xff]) // 0x05 + u16le watts
    this._log(`WRITE FTMS TargetPower ${watts}W (0x05): ${hex(payload)} `)
    await this._writeCpAndWaitAck(0x05, payload)
  }

  /**
   * setSim({ gradePct, crr, cwa, windMps })
   * gradePct: number in %, signed. crr: rolling resistance (e.g., 0.004), cwa: drag area (e.g., 0.51), windMps: headwind +, tailwind -.
   */
  async setSim({ gradePct, crr = 0.004, cwa = 0.51, windMps = 0 }) {
    const grade = Math.round(gradePct * 100) // 0.01% units -> s16
    const crrByte = Math.round(crr * 10000) // 1/10000 -> u8
    const cwaByte = Math.round(cwa * 100) // 1/100 -> u8
    const wind = Math.round(windMps * 100) // 0.01 m/s -> s16

    // bounds clamp
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
    const windClamped = clamp(wind, -32768, 32767)
    const gradeClamped = clamp(grade, -32768, 32767)
    const crrClamped = clamp(crrByte, 0, 255)
    const cwaClamped = clamp(cwaByte, 0, 255)

    const payload = new Uint8Array(1 + 2 + 2 + 1 + 1) // 0x11 + wind s16 + grade s16 + crr u8 + cwa u8
    const dv = new DataView(payload.buffer)
    dv.setUint8(0, 0x11)
    dv.setInt16(1, windClamped, true)
    dv.setInt16(3, gradeClamped, true)
    dv.setUint8(5, crrClamped)
    dv.setUint8(6, cwaClamped)

    this._log(
      `WRITE FTMS SIM wind=${(windClamped / 100).toFixed(2)}m/s grade=${(gradeClamped / 100).toFixed(2)}% crr=${(crrClamped / 10000).toFixed(4)} cw=${(cwaClamped / 100).toFixed(2)}: ${hex(payload)} `
    )
    await this._writeCpAndWaitAck(0x11, payload)
  }

  /**
   * rampSim({ fromPct, toPct, stepPct=1, dwellMs=5000, crr=0.004, cwa=0.51, windMps=0 })
   */
  async rampSim({
    fromPct,
    toPct,
    stepPct = 1,
    dwellMs = 5000,
    crr = 0.004,
    cwa = 0.51,
    windMps = 0,
  }) {
    const dir = Math.sign(toPct - fromPct) || 1
    const steps = []
    for (let g = fromPct; dir > 0 ? g <= toPct : g >= toPct; g += stepPct * dir) {
      steps.push(parseFloat(g.toFixed(2)))
      if ((dir > 0 && g + stepPct > toPct) || (dir < 0 && g - stepPct < toPct)) {
        if (steps[steps.length - 1] !== toPct) steps.push(toPct)
        break
      }
    }
    this._log(
      `=== RAMP ${fromPct}% -> ${toPct}% by ${stepPct}% every ${(dwellMs / 1000).toFixed(1)}s ===`
    )
    for (const g of steps) {
      this._log(`--- RAMP step -> ${g.toFixed(2)}% ---`)
      await this.setSim({ gradePct: g, crr, cwa, windMps })
      await delay(dwellMs)
    }
    this._log('RAMP complete.')
  }

  // --------- Private helpers ---------
  async _requestControl(timeoutMs = 4000) {
    const pkt = new Uint8Array([0x00]) // Request Control
    this._log(`WRITE FTMS RequestControl (0x00): ${hex(pkt)}`)
    await this._writeCpAndWaitAckDirect(0x00, pkt, timeoutMs)
  }

  async _writeCpAndWaitAckDirect(opcode, payload, timeoutMs = 4000) {
    // Direct write without auto-requesting control (used by _requestControl itself)
    if (this._pendingAck) {
      this._pendingAck.reject?.(new Error('Replaced by new command'))
      this._clearPendingAck()
    }
    // eslint-disable-next-line no-async-promise-executor
    const p = new Promise(async (resolve, reject) => {
      this._pendingAck = {
        opcode,
        resolve: (res) => {
          this._clearPendingAck()
          resolve(res)
        },
        reject: (err) => {
          this._clearPendingAck()
          reject(err)
        },
        timer: setTimeout(() => {
          this._clearPendingAck()
          reject(new Error('ACK timeout'))
        }, timeoutMs),
      }
      try {
        await this.chars.cp.writeValue(payload)
      } catch (e) {
        try {
          this._log(`writeValue failed (${e.message}), trying writeValueWithoutResponse…`)
          await this.chars.cp.writeValueWithoutResponse(payload)
        } catch (e2) {
          this._clearPendingAck()
          reject(e2)
        }
      }
    })
    const res = await p
    this.emit('ack', { forOpcode: opcode, result: res })
    if (res !== 0x01) throw new Error(`FTMS result 0x${res.toString(16).padStart(2, '0')}`)
    return res
  }

  async _writeCpAndWaitAck(opcode, payload, { timeoutMs = 4000 } = {}) {
    // Many trainers want us to own control before other ops.
    if (opcode !== 0x00) {
      // not REQUEST_CONTROL
      try {
        await this._requestControl(timeoutMs)
      } catch (e) {
        this._log(`WARN: RequestControl failed: ${e.message}`)
      }
    }

    // Clear any lingering waiter (should not happen in serialized flow)
    if (this._pendingAck) {
      this._pendingAck.reject?.(new Error('Replaced by new command'))
      this._clearPendingAck()
    }
    // eslint-disable-next-line no-async-promise-executor
    const p = new Promise(async (resolve, reject) => {
      // arm waiter
      this._pendingAck = {
        opcode,
        resolve: (res) => {
          this._clearPendingAck()
          resolve(res)
        },
        reject: (err) => {
          this._clearPendingAck()
          reject(err)
        },
        timer: setTimeout(() => {
          this._clearPendingAck()
          reject(new Error('ACK timeout'))
        }, timeoutMs),
      }
      try {
        // Prefer writeValue; fall back if it throws (like trainer_debug.html)
        await this.chars.cp.writeValue(payload)
      } catch (e) {
        try {
          this._log(`writeValue failed (${e.message}), trying writeValueWithoutResponse…`)
          await this.chars.cp.writeValueWithoutResponse(payload)
        } catch (e2) {
          this._clearPendingAck()
          reject(e2)
        }
      }
    })
    const res = await p // res = result code byte
    this.emit('ack', { forOpcode: opcode, result: res })
    if (res !== 0x01) throw new Error(`FTMS result 0x${res.toString(16).padStart(2, '0')}`)
    return res
  }

  _clearPendingAck() {
    if (this._pendingAck?.timer) clearTimeout(this._pendingAck.timer)
    this._pendingAck = null
  }

  _onCpIndication(dv) {
    const bytes = new Uint8Array(dv.buffer)
    const op = bytes[0] // should be 0x80 (response code)
    if (op === 0x80 && bytes.length >= 3) {
      const forOpcode = bytes[1]
      const result = bytes[2]
      this._log(
        `IND from FTMS CP: ${hex(bytes)}  (ACK for 0x${forOpcode.toString(16).padStart(2, '0')}, result=0x${result.toString(16).padStart(2, '0')})`
      )
      if (this._pendingAck && this._pendingAck.opcode === forOpcode) {
        this._pendingAck.resolve(result)
        return
      }
    }
    // If it wasn't our pending ack, just surface it
    this.emit('ack', { forOpcode: bytes[1], result: bytes[2] })
  }

  _parseIbd(dv) {
    // FTMS Indoor Bike Data (0x2AD2) parsing with flag-aware field detection
    // Spec: https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/
    let off = 0
    const flags = dv.getUint16(off, true)
    off += 2

    // Flag bits (from FTMS spec)
    const hasMoreData = !!(flags & 0x0001)
    const hasAvgSpeed = !!(flags & 0x0002)
    const hasInstantaneousCadence = !!(flags & 0x0004)
    const hasAvgCadence = !!(flags & 0x0008)
    const hasTotalDistance = !!(flags & 0x0010)
    const hasResistanceLevel = !!(flags & 0x0020)
    const hasInstantaneousPower = !!(flags & 0x0040)
    const hasAvgPower = !!(flags & 0x0080)
    const hasExpendedEnergy = !!(flags & 0x0100)
    const hasHeartRate = !!(flags & 0x0200)
    const hasMetabolicEquivalent = !!(flags & 0x0400)
    const hasElapsedTime = !!(flags & 0x0800)
    const hasRemainingTime = !!(flags & 0x1000)

    let speedKph = null,
      cadenceRpm = null,
      powerW = null,
      resistanceLevel = null

    // Always present: Instantaneous Speed (UINT16, 0.01 km/h resolution)
    if (dv.byteLength >= off + 2) {
      speedKph = dv.getUint16(off, true) / 100
      off += 2
    }

    // Conditional fields based on flags (in spec order)
    if (hasAvgSpeed && dv.byteLength >= off + 2) {
      off += 2 // Skip average speed
    }

    if (hasInstantaneousCadence && dv.byteLength >= off + 2) {
      cadenceRpm = dv.getUint16(off, true) / 2 // 0.5 rpm resolution
      off += 2
    }

    if (hasAvgCadence && dv.byteLength >= off + 2) {
      off += 2 // Skip average cadence
    }

    if (hasTotalDistance && dv.byteLength >= off + 3) {
      off += 3 // Skip total distance (24-bit)
    }

    if (hasResistanceLevel && dv.byteLength >= off + 2) {
      resistanceLevel = dv.getInt16(off, true) // Resistance Level (unitless)
      off += 2
    }

    if (hasInstantaneousPower && dv.byteLength >= off + 2) {
      powerW = dv.getInt16(off, true) // Instantaneous Power (watts)
      off += 2
    }

    if (hasAvgPower && dv.byteLength >= off + 2) {
      off += 2 // Skip average power
    }

    const obj = {
      flags: `0x${flags.toString(16).padStart(4, '0')}`,
      flagBits: {
        hasMoreData,
        hasAvgSpeed,
        hasInstantaneousCadence,
        hasAvgCadence,
        hasTotalDistance,
        hasResistanceLevel,
        hasInstantaneousPower,
        hasAvgPower,
        hasExpendedEnergy,
        hasHeartRate,
        hasMetabolicEquivalent,
        hasElapsedTime,
        hasRemainingTime,
      },
      raw: hex(dv.buffer),
      speedKph,
      cadenceRpm,
      powerW,
      resistanceLevel, // Added for debugging
    }

    this._log(
      `NOTIFY FTMS IBD: flags=${obj.flags} speed=${speedKph?.toFixed(1)} cadence=${cadenceRpm?.toFixed(0)} power=${powerW} resistance=${resistanceLevel}`
    )
    return obj
  }
}

// ============================================================================
// VIRTUAL GEARING MODULE
// ============================================================================
// Simulates a Shimano 105 2x11 drivetrain (50/34 front, 11-28 cassette)
// by adjusting FTMS resistance parameters (SIM gradient or ERG power)

// Calibration Data v1 - User's measured power curve (FTP=220W, baseline=34/17)
// Measured at 0% gradient, natural comfortable cadence per gear
const CALIBRATION_V1 = {
  metadata: {
    userFTP: 220,
    physicalBaselineGear: '34/17',
    physicalBaselineIndex: 5,
    tireCircumference: 2.136,
    testDate: '2026-02-19',
    notes: 'Constant cadence test (84-93 RPM), 8 measured gears, 14 interpolated',
  },
  // Measured data from calibration test (8 gears) + interpolated values
  calibratedCurve: [
    {
      gearIndex: 0,
      gear: '34/28',
      ratio: 1.21,
      measuredPower: 27,
      measuredCadence: 90,
      multiplier: 0.47,
      interpolated: false,
    },
    {
      gearIndex: 1,
      gear: '34/25',
      ratio: 1.36,
      measuredPower: 35,
      measuredCadence: 89,
      multiplier: 0.6,
      interpolated: true,
    },
    {
      gearIndex: 2,
      gear: '34/23',
      ratio: 1.48,
      measuredPower: 42,
      measuredCadence: 89,
      multiplier: 0.72,
      interpolated: false,
    },
    {
      gearIndex: 3,
      gear: '34/21',
      ratio: 1.62,
      measuredPower: 50,
      measuredCadence: 88,
      multiplier: 0.86,
      interpolated: true,
    },
    {
      gearIndex: 4,
      gear: '34/19',
      ratio: 1.79,
      measuredPower: 54,
      measuredCadence: 88,
      multiplier: 0.93,
      interpolated: true,
    },
    {
      gearIndex: 5,
      gear: '34/17',
      ratio: 2.0,
      measuredPower: 58,
      measuredCadence: 88,
      multiplier: 1.0,
      interpolated: false,
    }, // BASELINE
    {
      gearIndex: 6,
      gear: '34/15',
      ratio: 2.27,
      measuredPower: 70,
      measuredCadence: 87,
      multiplier: 1.21,
      interpolated: true,
    },
    {
      gearIndex: 7,
      gear: '34/14',
      ratio: 2.43,
      measuredPower: 78,
      measuredCadence: 87,
      multiplier: 1.34,
      interpolated: true,
    },
    {
      gearIndex: 8,
      gear: '34/13',
      ratio: 2.62,
      measuredPower: 88,
      measuredCadence: 87,
      multiplier: 1.52,
      interpolated: false,
    },
    {
      gearIndex: 9,
      gear: '34/12',
      ratio: 2.83,
      measuredPower: 98,
      measuredCadence: 86,
      multiplier: 1.69,
      interpolated: true,
    },
    {
      gearIndex: 10,
      gear: '34/11',
      ratio: 3.09,
      measuredPower: 110,
      measuredCadence: 86,
      multiplier: 1.9,
      interpolated: true,
    },
    {
      gearIndex: 11,
      gear: '50/28',
      ratio: 1.79,
      measuredPower: 54,
      measuredCadence: 88,
      multiplier: 0.93,
      interpolated: true,
    },
    {
      gearIndex: 12,
      gear: '50/25',
      ratio: 2.0,
      measuredPower: 60,
      measuredCadence: 88,
      multiplier: 1.03,
      interpolated: false,
    },
    {
      gearIndex: 13,
      gear: '50/23',
      ratio: 2.17,
      measuredPower: 75,
      measuredCadence: 87,
      multiplier: 1.29,
      interpolated: true,
    },
    {
      gearIndex: 14,
      gear: '50/21',
      ratio: 2.38,
      measuredPower: 95,
      measuredCadence: 86,
      multiplier: 1.64,
      interpolated: false,
    },
    {
      gearIndex: 15,
      gear: '50/19',
      ratio: 2.63,
      measuredPower: 115,
      measuredCadence: 85,
      multiplier: 1.98,
      interpolated: true,
    },
    {
      gearIndex: 16,
      gear: '50/17',
      ratio: 2.94,
      measuredPower: 138,
      measuredCadence: 84,
      multiplier: 2.38,
      interpolated: false,
    },
    {
      gearIndex: 17,
      gear: '50/15',
      ratio: 3.33,
      measuredPower: 165,
      measuredCadence: 84,
      multiplier: 2.84,
      interpolated: true,
    },
    {
      gearIndex: 18,
      gear: '50/14',
      ratio: 3.57,
      measuredPower: 180,
      measuredCadence: 84,
      multiplier: 3.1,
      interpolated: true,
    },
    {
      gearIndex: 19,
      gear: '50/13',
      ratio: 3.85,
      measuredPower: 202,
      measuredCadence: 85,
      multiplier: 3.48,
      interpolated: false,
    },
    {
      gearIndex: 20,
      gear: '50/12',
      ratio: 4.17,
      measuredPower: 225,
      measuredCadence: 85,
      multiplier: 3.88,
      interpolated: true,
    },
    {
      gearIndex: 21,
      gear: '50/11',
      ratio: 4.55,
      measuredPower: 250,
      measuredCadence: 85,
      multiplier: 4.31,
      interpolated: true,
    },
  ],
}

class VirtualGear {
  constructor() {
    // Shimano 105 2x11 gear table
    this.gearTable = [
      { index: 0, front: 34, rear: 28, ratio: 1.21 }, // Easiest
      { index: 1, front: 34, rear: 25, ratio: 1.36 },
      { index: 2, front: 34, rear: 23, ratio: 1.48 },
      { index: 3, front: 34, rear: 21, ratio: 1.62 },
      { index: 4, front: 34, rear: 19, ratio: 1.79 },
      { index: 5, front: 34, rear: 17, ratio: 2.0 }, // BASELINE (straight chainline)
      { index: 6, front: 34, rear: 15, ratio: 2.27 },
      { index: 7, front: 34, rear: 14, ratio: 2.43 },
      { index: 8, front: 34, rear: 13, ratio: 2.62 },
      { index: 9, front: 34, rear: 12, ratio: 2.83 },
      { index: 10, front: 34, rear: 11, ratio: 3.09 },
      { index: 11, front: 50, rear: 28, ratio: 1.79 },
      { index: 12, front: 50, rear: 25, ratio: 2.0 },
      { index: 13, front: 50, rear: 23, ratio: 2.17 },
      { index: 14, front: 50, rear: 21, ratio: 2.38 },
      { index: 15, front: 50, rear: 19, ratio: 2.63 },
      { index: 16, front: 50, rear: 17, ratio: 2.94 },
      { index: 17, front: 50, rear: 15, ratio: 3.33 },
      { index: 18, front: 50, rear: 14, ratio: 3.57 },
      { index: 19, front: 50, rear: 13, ratio: 3.85 },
      { index: 20, front: 50, rear: 12, ratio: 4.17 },
      { index: 21, front: 50, rear: 11, ratio: 4.55 }, // Hardest
    ]

    this.currentGearIndex = 5 // Start at baseline (34/17 straight chainline)
    this.baselineGearIndex = 5 // Baseline gear index (34/17)
    this.baselineRatio = 2.0 // Gear 5 ratio
    this.enabled = true // Virtual gearing enabled by default

    this.calibration = {
      method: 'calibrated', // 'ftp-based', 'ratio-based', or 'calibrated'
      userFTP: 220, // User's FTP in watts
      optimalCadence: 90, // rpm, peak power cadence
      baselineSpeed: 30, // kph, speed for power curve calculations
    }

    // Power curve data (populated by FTP model or calibration)
    this.powerCurve = null // Array of { gearIndex, power, cadence, multiplier }

    this.listeners = {} // Event listeners
    this.logFn = null // Logger function

    // Load calibration v1 data
    this.loadCalibrationFromJSON(CALIBRATION_V1)
  }

  // Shift to harder gear (higher ratio)
  shiftUp() {
    if (this.currentGearIndex < this.gearTable.length - 1) {
      this.currentGearIndex++
      const gear = this.getCurrentGear()
      this._log(`Shifted UP to gear ${gear.index + 1} (${gear.display})`)
      this.emit('gearChange', gear)
      return true
    }
    return false
  }

  // Shift to easier gear (lower ratio)
  shiftDown() {
    if (this.currentGearIndex > 0) {
      this.currentGearIndex--
      const gear = this.getCurrentGear()
      this._log(`Shifted DOWN to gear ${gear.index + 1} (${gear.display})`)
      this.emit('gearChange', gear)
      return true
    }
    return false
  }

  // Get current gear object with calculated properties
  getCurrentGear() {
    const gear = this.gearTable[this.currentGearIndex]
    return {
      index: gear.index,
      front: gear.front,
      rear: gear.rear,
      ratio: gear.ratio,
      display: `${gear.front}/${gear.rear}`,
      multiplier: this.getMultiplier(),
    }
  }

  // Calculate resistance multiplier relative to baseline
  getMultiplier() {
    // Use power curve if available (FTP-based or calibrated)
    if (this.powerCurve && this.powerCurve[this.currentGearIndex]) {
      return this.powerCurve[this.currentGearIndex].multiplier
    }

    // Fallback to simple ratio calculation
    const currentRatio = this.gearTable[this.currentGearIndex].ratio
    return currentRatio / this.baselineRatio
  }

  // Apply gear multiplier to SIM mode gradient
  applyToGradient(baseGradient) {
    if (!this.enabled) return baseGradient

    const multiplier = this.getMultiplier()
    const adjusted = baseGradient * multiplier

    // Safety limits: -10% to +20%
    return Math.max(-10, Math.min(20, adjusted))
  }

  // Apply gear multiplier to ERG mode power
  applyToPower(basePower) {
    if (!this.enabled) return basePower

    const multiplier = this.getMultiplier()
    const adjusted = basePower * multiplier

    // Safety limits: 50W to 2000W
    return Math.max(50, Math.min(2000, Math.round(adjusted)))
  }

  // Generate FTP-based power curve using cadence-power model
  generateFTPBasedCurve() {
    const { userFTP, optimalCadence, baselineSpeed } = this.calibration
    const wheelCircumference = 2.136 // meters (700x28c)

    this.powerCurve = this.gearTable.map((gear, idx) => {
      // Calculate cadence for this gear at baseline speed (30 kph)
      const speedMps = baselineSpeed / 3.6 // kph to m/s
      const wheelRpm = (speedMps / wheelCircumference) * 60
      const cadence = wheelRpm / gear.ratio

      // Coggan's quadratic cadence-power model
      // Peak power at optimal cadence, drops off parabolically
      const cadenceDeviation = cadence - optimalCadence
      const cadencePenalty = 1 - 0.0025 * Math.pow(cadenceDeviation, 2)
      const power = userFTP * 0.75 * Math.max(0.5, cadencePenalty) // 75% FTP at optimal

      // Calculate multiplier relative to baseline gear
      const baselinePower = this.powerCurve
        ? this.powerCurve[this.baselineGearIndex].power
        : userFTP * 0.75
      const multiplier = idx === this.baselineGearIndex ? 1.0 : power / baselinePower

      return {
        gearIndex: idx,
        gear: `${gear.front}/${gear.rear}`,
        ratio: gear.ratio,
        cadence: Math.round(cadence),
        power: Math.round(power),
        multiplier: multiplier,
      }
    })

    // Recalculate multipliers now that baseline is known
    const baselinePower = this.powerCurve[this.baselineGearIndex].power
    this.powerCurve.forEach((point) => {
      point.multiplier = point.power / baselinePower
    })

    this._log(
      `Generated FTP curve: FTP=${userFTP}W, baseline=${this.powerCurve[this.baselineGearIndex].gear} @ ${baselinePower}W`
    )
    this.calibration.method = 'ftp-based'
  }

  // Update FTP and regenerate curve
  setFTP(ftp) {
    this.calibration.userFTP = ftp
    this.generateFTPBasedCurve()
    this._log(`FTP updated to ${ftp}W, curve regenerated`)
  }

  // Set baseline gear (34/21, 50/17, etc.)
  setBaselineGear(gearIndex) {
    if (gearIndex < 0 || gearIndex >= this.gearTable.length) {
      this._log(`Invalid baseline gear index: ${gearIndex}`)
      return
    }

    this.baselineGearIndex = gearIndex
    this.currentGearIndex = gearIndex
    this.baselineRatio = this.gearTable[gearIndex].ratio

    // Regenerate curve with new baseline
    if (this.calibration.method === 'ftp-based') {
      this.generateFTPBasedCurve()
    }

    const gear = this.gearTable[gearIndex]
    this._log(`Baseline gear set to ${gear.front}/${gear.rear} (index ${gearIndex})`)
  }

  // Load custom calibration data from test
  loadCalibrationData(calibrationData) {
    // Expected format: [{ gearIndex, gear, avgPower, avgCadence, avgSpeed }, ...]
    if (!Array.isArray(calibrationData) || calibrationData.length === 0) {
      this._log('Invalid calibration data')
      return false
    }

    // Build power curve from calibration
    const baselineData = calibrationData.find((d) => d.gearIndex === this.baselineGearIndex)
    if (!baselineData) {
      this._log('Calibration missing baseline gear data')
      return false
    }

    const baselinePower = baselineData.avgPower

    this.powerCurve = this.gearTable.map((gear, idx) => {
      const calData = calibrationData.find((d) => d.gearIndex === idx)

      if (calData) {
        // Use actual calibrated data
        return {
          gearIndex: idx,
          gear: `${gear.front}/${gear.rear}`,
          ratio: gear.ratio,
          cadence: Math.round(calData.avgCadence),
          power: Math.round(calData.avgPower),
          multiplier: calData.avgPower / baselinePower,
        }
      } else {
        // Interpolate for missing gears
        return {
          gearIndex: idx,
          gear: `${gear.front}/${gear.rear}`,
          ratio: gear.ratio,
          cadence: null,
          power: null,
          multiplier: gear.ratio / this.baselineRatio, // Fallback to ratio
        }
      }
    })

    this.calibration.method = 'calibrated'
    this._log(`Loaded calibration data with ${calibrationData.length} data points`)
    return true
  }

  // Load calibration from JSON format (from power-curve-calibration.html output)
  loadCalibrationFromJSON(jsonData) {
    if (!jsonData || !jsonData.metadata || !jsonData.calibratedCurve) {
      this._log('Invalid JSON calibration format')
      return false
    }

    // Update baseline from metadata
    this.baselineGearIndex = jsonData.metadata.physicalBaselineIndex
    this.baselineRatio = this.gearTable[this.baselineGearIndex].ratio
    this.currentGearIndex = this.baselineGearIndex
    this.calibration.userFTP = jsonData.metadata.userFTP

    // Load power curve directly from calibratedCurve array
    this.powerCurve = jsonData.calibratedCurve.map((item) => ({
      gearIndex: item.gearIndex,
      gear: item.gear,
      ratio: item.ratio,
      power: item.measuredPower,
      cadence: item.measuredCadence,
      multiplier: item.multiplier,
      interpolated: item.interpolated,
    }))

    this.calibration.method = 'calibrated'

    const measuredCount = this.powerCurve.filter((g) => !g.interpolated).length
    const baselineGear = this.gearTable[this.baselineGearIndex]
    this._log(
      `Loaded calibration v1: FTP=${jsonData.metadata.userFTP}W, baseline=${baselineGear.front}/${baselineGear.rear}, ${measuredCount} measured gears`
    )

    return true
  }

  // Calculate target power based on FTP calibration
  // Formula: Baseline gear at optimal cadence = 75% FTP
  calculateTargetPower(cadence = 90) {
    const baselinePower = this.calibration.userFTP * 0.75
    const cadenceRatio = cadence / this.calibration.optimalCadence
    const gearRatio = this.getMultiplier()

    // Power scales with gear ratio and cadence^1.5
    return baselinePower * gearRatio * Math.pow(cadenceRatio, 1.5)
  }

  // Event emitter: register listener
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }

  // Event emitter: trigger event
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data))
    }
  }

  // Internal logging
  _log(msg) {
    if (this.logFn) {
      this.logFn(`[VirtualGear] ${msg}`)
    }
    console.log(`[VirtualGear] ${msg}`)
  }
}

// Export a ready-to-use singleton, plus the class if you want multiple instances
// Support both ES6 modules and global scope for browser compatibility
/* eslint-disable no-undef */
if (typeof module !== 'undefined' && module.exports) {
  // Node.js style export
  const ftmsInstance = new FTMSClient()
  ftmsInstance.virtualGear = new VirtualGear()
  module.exports = { ftms: ftmsInstance, FTMSClient, VirtualGear }
  /* eslint-enable no-undef */
} else if (typeof window !== 'undefined') {
  // Browser global export
  window.ftms = new FTMSClient()
  window.ftms.virtualGear = new VirtualGear()
  window.FTMSClient = FTMSClient
  window.VirtualGear = VirtualGear
}
