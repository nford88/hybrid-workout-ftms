import { describe, test, expect } from 'vitest'
import {
  parseZapFrame,
  decodeVarint,
  createShiftEdgeDetector,
  OUR_CLICK_BUTTONS,
  V2_BUTTON_MASK,
} from '../../src/dev/protocols/zapFrame'

// Fixtures below are third-party-sourced (ajchellew/zwiftplay, qdomyos-zwift,
// makinolo.com — see docs/virtual-shifting/PROTOCOLS.md §1.4) and are CONFIRMED
// claims in the research docs, not yet captured from our own hardware (HW-V4/V5
// will add/replace these with our unit's actual bytes).

describe('parseZapFrame — Click v1 (type 0x37)', () => {
  test('idle frame: both released', () => {
    const result = parseZapFrame([0x37, 0x08, 0x01, 0x10, 0x01])
    expect(result.type).toBe('click-v1-buttons')
    expect(result.upPressed).toBe(false)
    expect(result.downPressed).toBe(false)
  })

  test('shift-up pressed (inverse logic: 0 = pressed)', () => {
    const result = parseZapFrame([0x37, 0x08, 0x00, 0x10, 0x01])
    expect(result.type).toBe('click-v1-buttons')
    expect(result.upPressed).toBe(true)
    expect(result.downPressed).toBe(false)
  })

  test('shift-down pressed', () => {
    const result = parseZapFrame([0x37, 0x08, 0x01, 0x10, 0x00])
    expect(result.type).toBe('click-v1-buttons')
    expect(result.upPressed).toBe(false)
    expect(result.downPressed).toBe(true)
  })
})

describe('decodeVarint', () => {
  test('decodes the all-ones 32-bit varint (5 bytes, FF FF FF FF 0F) to 0xFFFFFFFF', () => {
    const { value, bytesRead } = decodeVarint([0xff, 0xff, 0xff, 0xff, 0x0f], 0)
    expect(value).toBe(0xffffffff)
    expect(bytesRead).toBe(5)
  })

  test('decodes a single-byte varint', () => {
    const { value, bytesRead } = decodeVarint([0x08], 0)
    expect(value).toBe(0x08)
    expect(bytesRead).toBe(1)
  })
})

describe('parseZapFrame — v2/Ride bitmap (type 0x23)', () => {
  test('all-released frame', () => {
    const result = parseZapFrame([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f])
    expect(result.type).toBe('v2-buttons')
    expect(result.bitmap).toBe(0xffffffff)
    expect(result.shiftUp).toBe(false)
    expect(result.shiftDown).toBe(false)
  })

  // Fixtures below are from our own hardware (docs/virtual-shifting/experiments/
  // 04-click-mapping-and-relay-confirmed.md, 2026-07-28) — NOT the community-guessed
  // SHFT_UP_R/SHFT_DN_L bits, which turned out wrong for this Click's paddles.
  // CORRECTED 2026-07-29 (experiments/16 Phase 1): every button was pressed and labelled
  // in one session. The "+" paddle is 0x1000; 0x20 is the B face button. The old fixture
  // asserted 0x20 == "+", so shiftUp fired on B and never on the paddle.
  test('Right "+" paddle pressed (bit 0x1000)', () => {
    const result = parseZapFrame([0x23, 0x08, 0xff, 0xdf, 0xff, 0xff, 0x0f])
    expect(result.bitmap).toBe(0xffffefff)
    expect(result.shiftUp).toBe(true)
    expect(result.shiftDown).toBe(false)
  })

  test('B face button (0x20) is NOT a shift — the bug this replaced', () => {
    const result = parseZapFrame([0x23, 0x08, 0xdf, 0xff, 0xff, 0xff, 0x0f])
    expect(result.bitmap).toBe(0xffffffdf)
    expect(result.shiftUp).toBe(false)
    expect(result.shiftDown).toBe(false)
  })

  test('every button in the confirmed 2026-07-29 map decodes to its own bit', () => {
    const expected = [
      ['D-pad LEFT', [0xfe, 0xff, 0xff, 0xff, 0x0f], 0x1],
      ['D-pad UP', [0xfd, 0xff, 0xff, 0xff, 0x0f], 0x2],
      ['D-pad RIGHT', [0xfb, 0xff, 0xff, 0xff, 0x0f], 0x4],
      ['D-pad DOWN', [0xf7, 0xff, 0xff, 0xff, 0x0f], 0x8],
      ['A', [0xef, 0xff, 0xff, 0xff, 0x0f], 0x10],
      ['B', [0xdf, 0xff, 0xff, 0xff, 0x0f], 0x20],
      ['Y', [0xbf, 0xff, 0xff, 0xff, 0x0f], 0x40],
      ['Z', [0xff, 0xfe, 0xff, 0xff, 0x0f], 0x80],
      ['Left "−"', [0xff, 0xfd, 0xff, 0xff, 0x0f], 0x100],
      ['Right "+"', [0xff, 0xdf, 0xff, 0xff, 0x0f], 0x1000],
    ]
    for (const [name, tail, bit] of expected) {
      const { bitmap } = parseZapFrame([0x23, 0x08, ...tail])
      // active-low: exactly the one bit is cleared
      expect(`${name}:${(~bitmap >>> 0) & 0x3ffff}`).toBe(`${name}:${bit}`)
    }
  })

  test("Z is 0x80 on our hardware, not the community table's 0x100", () => {
    expect(OUR_CLICK_BUTTONS.Z).toBe(0x80)
    expect(V2_BUTTON_MASK.Z).toBe(0x100)
    expect(OUR_CLICK_BUTTONS.LEFT_MINUS).toBe(V2_BUTTON_MASK.Z)
  })

  test('Left "−" paddle pressed (bit 0x100)', () => {
    const result = parseZapFrame([0x23, 0x08, 0xff, 0xfd, 0xff, 0xff, 0x0f])
    expect(result.shiftUp).toBe(false)
    expect(result.shiftDown).toBe(true)
  })

  test('Left D-pad bits match the borrowed community mask table (up/left/right/down)', () => {
    expect(parseZapFrame([0x23, 0x08, 0xfd, 0xff, 0xff, 0xff, 0x0f]).bitmap).toBe(0xfffffffd) // up
    expect(parseZapFrame([0x23, 0x08, 0xfe, 0xff, 0xff, 0xff, 0x0f]).bitmap).toBe(0xfffffffe) // left
    expect(parseZapFrame([0x23, 0x08, 0xfb, 0xff, 0xff, 0xff, 0x0f]).bitmap).toBe(0xfffffffb) // right
    expect(parseZapFrame([0x23, 0x08, 0xf7, 0xff, 0xff, 0xff, 0x0f]).bitmap).toBe(0xfffffff7) // down
  })
})

describe('parseZapFrame — status frames', () => {
  test('idle keepalive (0x15)', () => {
    expect(parseZapFrame([0x15, 0x00]).type).toBe('idle-keepalive')
  })

  test('battery level (0x19 08 <level>)', () => {
    const result = parseZapFrame([0x19, 0x08, 0x55])
    expect(result.type).toBe('battery')
    expect(result.level).toBe(0x55)
  })

  test('unrecognized type falls through as unknown, preserving raw hex', () => {
    const result = parseZapFrame([0xfe, 0x05, 0x00])
    expect(result.type).toBe('unknown')
    expect(result.messageType).toBe(0xfe)
    expect(result.raw).toBe('fe 05 00')
  })
})

describe('createShiftEdgeDetector', () => {
  test('emits one up event on press, none while held, none on release', () => {
    const detector = createShiftEdgeDetector()
    const idle = parseZapFrame([0x37, 0x08, 0x01, 0x10, 0x01])
    const upPressed = parseZapFrame([0x37, 0x08, 0x00, 0x10, 0x01])

    expect(detector.feed(idle, 0)).toEqual([])
    expect(detector.feed(upPressed, 100)).toEqual([{ type: 'shift', direction: 'up', ts: 100 }])
    // Held: repeated identical frame must NOT re-emit
    expect(detector.feed(upPressed, 600)).toEqual([])
    // Released
    expect(detector.feed(idle, 1100)).toEqual([])
    // Pressed again → new edge
    expect(detector.feed(upPressed, 1600)).toEqual([{ type: 'shift', direction: 'up', ts: 1600 }])
  })

  test('tracks up and down independently', () => {
    const detector = createShiftEdgeDetector()
    const downPressed = parseZapFrame([0x37, 0x08, 0x01, 0x10, 0x00])
    expect(detector.feed(downPressed, 0)).toEqual([{ type: 'shift', direction: 'down', ts: 0 }])
  })
})

// Minimal LEB128 encoder, test-only — mirrors the decode logic in zapFrame.js so
// fixtures can be constructed for arbitrary bitmap values without hand-computing bytes.
function encodeVarintForTest(value) {
  const bytes = []
  let v = value
  do {
    let byte = v & 0x7f
    v = v >>> 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return bytes
}
