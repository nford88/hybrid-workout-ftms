// FTMS Control Point codecs — pure functions, no BLE dependency.
//
// Throwaway research instrumentation for the virtual-shifting hardware experiments
// (docs/virtual-shifting/experiments/). Layout is FTMS v1.0 Table 4.20 (see
// docs/virtual-shifting/PROTOCOLS.md §3.2). This module intentionally encodes wind
// speed at the spec-correct 0.001 m/s resolution — it does NOT reproduce the latent
// 0.01 m/s bug in src/js/ftms.js:241 (that fix belongs to a future implementation
// session, not this harness).

const OPCODE = {
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
