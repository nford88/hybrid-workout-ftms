// Zwift Accessory Protocol (ZAP) frame parser — pure functions, no BLE dependency.
//
// Throwaway research instrumentation for the virtual-shifting hardware experiments
// (docs/virtual-shifting/experiments/). Byte layouts are from community reverse-engineering
// (ajchellew/zwiftplay, qdomyos-zwift, makinolo.com) — see docs/virtual-shifting/PROTOCOLS.md
// §1. Fixtures used in tests/unit/zap-frame-parser.test.js are third-party-sourced until
// HW-V4/V5 replace them with bytes captured from our own Click.

export const ZAP_FRAME_TYPE = {
  CLICK_V1_BUTTONS: 0x37,
  V2_BUTTONS: 0x23,
  PLAY_FW1_PADS: 0x07,
  IDLE_KEEPALIVE: 0x15,
  BATTERY: 0x19,
  INITIAL_STATUS: 0x2a,
}

// CONFIRMED on our own hardware (docs/virtual-shifting/experiments/04-click-mapping-and-
// relay-confirmed.md, 2026-07-28): a Click "Left"/"Right" pair, where only ONE physical
// unit needs a BLE connection — its sibling's button presses arrive on the same
// connection (relay-confirmed; see the experiment file). The D-pad/face-button bits
// below match the borrowed V2_BUTTON_MASK table exactly, but the two dedicated shift
// paddles do NOT match their borrowed "SHFT_UP_R"/"SHFT_DN_L" names — don't use those
// for the paddles, use these instead.
export const OUR_CLICK_PADDLES = {
  RIGHT_PLUS: 0x20, // NOT V2_BUTTON_MASK.SHFT_UP_R (0x2000) — confirmed 4x independently
  LEFT_MINUS: 0x100, // NOT V2_BUTTON_MASK.SHFT_DN_L (0x400)
}

// v2/Ride/Play-fw2 active-low bitmap field masks (PROTOCOLS.md §1.4) — community-sourced,
// NOT verified against our hardware for the shift paddles (see OUR_CLICK_PADDLES above).
// The D-pad/face-button entries (LEFT/UP/RIGHT/DOWN/Y/Z/A) do match our captures.
export const V2_BUTTON_MASK = {
  LEFT: 0x1,
  UP: 0x2,
  RIGHT: 0x4,
  DOWN: 0x8,
  A: 0x10,
  B: 0x20,
  Y: 0x40,
  Z: 0x100,
  SHFT_UP_L: 0x200,
  SHFT_DN_L: 0x400,
  POWERUP_L: 0x800,
  ONOFF_L: 0x1000,
  SHFT_UP_R: 0x2000,
  SHFT_DN_R: 0x4000,
  POWERUP_R: 0x10000,
  ONOFF_R: 0x20000,
}

export function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')
}

function asUint8Array(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

// Protobuf-style unsigned LEB128 varint decode. Returns { value, bytesRead }.
// Values here are bounded to 32 bits (button bitmaps), so plain Number arithmetic
// (not BigInt) is safe — Number.MAX_SAFE_INTEGER comfortably covers 2^32.
export function decodeVarint(bytes, offset) {
  let value = 0
  let shift = 0
  let i = offset
  while (true) {
    const byte = bytes[i]
    value += (byte & 0x7f) * Math.pow(2, shift)
    i += 1
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, bytesRead: i - offset }
}

function parseClickV1(arr, hex) {
  // `37 08 <up> 10 <down>` — inverse logic: 0 = pressed, 1 = released.
  const upByte = arr[2]
  const downByte = arr[4]
  return {
    type: 'click-v1-buttons',
    upPressed: upByte === 0,
    downPressed: downByte === 0,
    raw: hex,
  }
}

function parseV2Bitmap(arr, hex) {
  // `23 08 <varint bitmap>` — active-low: bit clear (0) = pressed.
  const { value: bitmap } = decodeVarint(arr, 2)
  const pressed = (mask) => (bitmap & mask) === 0
  return {
    type: 'v2-buttons',
    bitmap,
    // Our hardware has exactly one shift paddle per physical unit (Right "+", Left "−"),
    // not four independent L/R up/down bits — see OUR_CLICK_PADDLES above.
    shiftUp: pressed(OUR_CLICK_PADDLES.RIGHT_PLUS),
    shiftDown: pressed(OUR_CLICK_PADDLES.LEFT_MINUS),
    raw: hex,
  }
}

/**
 * Parse a single ZAP ASYNC notification frame (byte 0 = message type).
 * Returns a discriminated object; unrecognized types pass through as 'unknown'
 * with the raw hex so the harness can still log them.
 */
export function parseZapFrame(bytes) {
  const arr = asUint8Array(bytes)
  const hex = toHex(arr)
  const type = arr[0]
  switch (type) {
    case ZAP_FRAME_TYPE.CLICK_V1_BUTTONS:
      return parseClickV1(arr, hex)
    case ZAP_FRAME_TYPE.V2_BUTTONS:
      return parseV2Bitmap(arr, hex)
    case ZAP_FRAME_TYPE.IDLE_KEEPALIVE:
      return { type: 'idle-keepalive', raw: hex }
    case ZAP_FRAME_TYPE.BATTERY:
      return { type: 'battery', level: arr[2], raw: hex }
    case ZAP_FRAME_TYPE.INITIAL_STATUS:
      return { type: 'initial-status', raw: hex }
    default:
      return { type: 'unknown', messageType: type, raw: hex }
  }
}

/**
 * Turns a stream of parsed frames into edge-triggered shift events (press only,
 * matching the ShiftEvent model in VIRTUAL_SHIFTING_DESIGN.md §4.2). Handles both
 * v1 (per-button booleans) and v2 (bitmap) schemas. Held buttons repeat their raw
 * frame every ~500ms on real hardware (per QZ) — this collapses that to one event
 * per press, which is what production shift-input code will want; the harness UI
 * can still show raw repeat cadence separately from this detector's output.
 */
export function createShiftEdgeDetector() {
  let prevUp = false
  let prevDown = false

  function feed(parsedFrame, ts) {
    if (parsedFrame.type !== 'click-v1-buttons' && parsedFrame.type !== 'v2-buttons') {
      return []
    }
    const up = parsedFrame.type === 'click-v1-buttons' ? parsedFrame.upPressed : parsedFrame.shiftUp
    const down = parsedFrame.type === 'click-v1-buttons' ? parsedFrame.downPressed : parsedFrame.shiftDown

    const events = []
    if (up && !prevUp) events.push({ type: 'shift', direction: 'up', ts })
    if (down && !prevDown) events.push({ type: 'shift', direction: 'down', ts })
    prevUp = up
    prevDown = down
    return events
  }

  return { feed }
}
