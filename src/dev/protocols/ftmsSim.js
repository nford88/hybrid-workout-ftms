// FTMS Control Point codecs — pure functions, no BLE dependency.
//
// Throwaway research instrumentation for the virtual-shifting hardware experiments
// (docs/virtual-shifting/experiments/). Layout is FTMS v1.0 Table 4.20 (see
// docs/virtual-shifting/PROTOCOLS.md §3.2). This module intentionally encodes wind
// speed at the spec-correct 0.001 m/s resolution — it does NOT reproduce the latent
// 0.01 m/s bug in src/js/ftms.js:241 (that fix belongs to a future implementation
// session, not this harness).

const OPCODE = {
  SET_TARGET_RESISTANCE: 0x04,
  SET_SIM_PARAMS: 0x11,
}

function readInt16LE(arr, offset) {
  const raw = arr[offset] | (arr[offset + 1] << 8)
  return raw > 0x7fff ? raw - 0x10000 : raw
}

function writeInt16LE(buf, offset, value) {
  const clamped = Math.max(-32768, Math.min(32767, Math.round(value)))
  const raw = clamped < 0 ? clamped + 0x10000 : clamped
  buf[offset] = raw & 0xff
  buf[offset + 1] = (raw >> 8) & 0xff
}

/**
 * Encode a 0x11 Set Indoor Bike Simulation Parameters payload.
 * @param {{windMps?: number, gradePct?: number, crr?: number, cw?: number}} params
 * @returns {Uint8Array} 7 bytes: opcode, wind s16 @0.001 m/s, grade s16 @0.01%, crr u8 @0.0001, cw u8 @0.01
 */
export function encodeSimParams({ windMps = 0, gradePct = 0, crr = 0.004, cw = 0.51 } = {}) {
  const buf = new Uint8Array(7)
  buf[0] = OPCODE.SET_SIM_PARAMS
  writeInt16LE(buf, 1, windMps / 0.001)
  writeInt16LE(buf, 3, gradePct / 0.01)
  buf[5] = Math.max(0, Math.min(255, Math.round(crr / 0.0001)))
  buf[6] = Math.max(0, Math.min(255, Math.round(cw / 0.01)))
  return buf
}

/**
 * Decode a 0x11 Set Indoor Bike Simulation Parameters payload (e.g. to verify what
 * was actually put on the wire, or to parse a captured hex dump during analysis).
 * @param {Uint8Array|number[]} bytes
 */
export function decodeSimParams(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return {
    opcode: arr[0],
    windMps: readInt16LE(arr, 1) * 0.001,
    gradePct: readInt16LE(arr, 3) * 0.01,
    crr: arr[5] * 0.0001,
    cw: arr[6] * 0.01,
  }
}

/**
 * Encode a 0x04 Set Target Resistance Level payload (HW-V12 candidate (e)).
 * @param {number} level unitless resistance level, resolution 0.1
 * @returns {Uint8Array} 3 bytes: opcode, level s16 @0.1
 */
export function encodeTargetResistance(level) {
  const buf = new Uint8Array(3)
  buf[0] = OPCODE.SET_TARGET_RESISTANCE
  writeInt16LE(buf, 1, level / 0.1)
  return buf
}

/**
 * Decode the Fitness Machine Feature characteristic (0x2ACC) — two little-endian
 * uint32 bitfields: Fitness Machine Features, then Target Setting Features.
 * HW-V12 candidate (e) is only viable if Target Setting Features bit 2
 * (Resistance Target Setting Supported) is set (FTMS v1.0 §4.3.1.1).
 * @param {Uint8Array|number[]} bytes at least 8 bytes
 */
export function decodeFitnessMachineFeature(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const readU32LE = (offset) =>
    (arr[offset] | (arr[offset + 1] << 8) | (arr[offset + 2] << 16) | (arr[offset + 3] << 24)) >>> 0
  const fitnessMachineFeatures = readU32LE(0)
  const targetSettingFeatures = readU32LE(4)
  return {
    fitnessMachineFeatures,
    targetSettingFeatures,
    resistanceTargetSupported: !!(targetSettingFeatures & (1 << 2)),
    powerTargetSupported: !!(targetSettingFeatures & (1 << 3)),
    simParamsSupported: !!(targetSettingFeatures & (1 << 13)),
  }
}
