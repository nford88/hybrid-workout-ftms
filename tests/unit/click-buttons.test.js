import { describe, test, expect } from 'vitest'
import {
  parseClickFrame,
  decodeVarint,
  CLICK_BUTTON,
  ALL_CLICK_BUTTONS,
  buttonsForUnit,
  pressedButtons,
  isPressed,
  unknownPressedBits,
  createButtonEdgeDetector,
} from '../../src/services/clickButtons'
import {
  DEFAULT_CLICK_BINDINGS,
  DEFAULT_KEY_BINDINGS,
  normaliseClickBindings,
  normaliseKeyBindings,
  bindKey,
  keyForAction,
  actionForKey,
  unreachableActions,
} from '../../src/services/clickBindings'

const ALL_RELEASED = 0xffffffff
const press = (...bits) => bits.reduce((bm, b) => bm & ~b, ALL_RELEASED) >>> 0

describe('clickButtons — the map confirmed on our hardware 2026-07-29', () => {
  test('the "+" paddle is 0x1000, not 0x20 (the bug this map replaced)', () => {
    expect(CLICK_BUTTON.SHIFT_UP).toBe(0x1000)
    expect(CLICK_BUTTON.B).toBe(0x20)
  })

  test('Z is 0x80 — a bit the community table does not list', () => {
    expect(CLICK_BUTTON.Z).toBe(0x80)
  })

  test('face buttons occupy a contiguous run and neither paddle is inside it', () => {
    expect([CLICK_BUTTON.A, CLICK_BUTTON.B, CLICK_BUTTON.Y, CLICK_BUTTON.Z]).toEqual([
      0x10, 0x20, 0x40, 0x80,
    ])
    expect(CLICK_BUTTON.SHIFT_DOWN).toBeGreaterThan(CLICK_BUTTON.Z)
    expect(CLICK_BUTTON.SHIFT_UP).toBeGreaterThan(CLICK_BUTTON.SHIFT_DOWN)
  })

  test('every bit is distinct', () => {
    const bits = ALL_CLICK_BUTTONS.map((id) => CLICK_BUTTON[id])
    expect(new Set(bits).size).toBe(bits.length)
  })

  test('decodes real captured frames', () => {
    // 23 08 ff df ff ff 0f -> "+" paddle, from the 2026-07-29 bench session
    expect(pressedButtons(0xffffefff)).toEqual(['SHIFT_UP'])
    // 23 08 ff fd ff ff 0f -> "−" paddle
    expect(pressedButtons(0xfffffeff)).toEqual(['SHIFT_DOWN'])
    expect(pressedButtons(press(CLICK_BUTTON.SHIFT_DOWN))).toEqual(['SHIFT_DOWN'])
    expect(pressedButtons(ALL_RELEASED)).toEqual([])
  })

  test('active-low: a cleared bit means pressed', () => {
    expect(isPressed(press(CLICK_BUTTON.A), 'A')).toBe(true)
    expect(isPressed(ALL_RELEASED, 'A')).toBe(false)
  })

  test('chords report every pressed button', () => {
    expect(pressedButtons(press(CLICK_BUTTON.DPAD_UP, CLICK_BUTTON.SHIFT_UP)).sort()).toEqual(
      ['DPAD_UP', 'SHIFT_UP'].sort()
    )
  })

  test('an undocumented bit is surfaced, not swallowed', () => {
    expect(unknownPressedBits(press(0x8000))).toEqual([0x8000])
    expect(unknownPressedBits(press(CLICK_BUTTON.A))).toEqual([])
  })

  test('the walkthrough splits buttons by physical unit', () => {
    expect(buttonsForUnit('left')).toEqual([
      'DPAD_LEFT',
      'DPAD_UP',
      'DPAD_RIGHT',
      'DPAD_DOWN',
      'SHIFT_DOWN',
    ])
    expect(buttonsForUnit('right')).toEqual(['A', 'B', 'Y', 'Z', 'SHIFT_UP'])
    expect(buttonsForUnit('left').length + buttonsForUnit('right').length).toBe(
      ALL_CLICK_BUTTONS.length
    )
  })
})

describe('clickButtons — edge detection at ~10 Hz', () => {
  test('a held button counts once, not once per frame', () => {
    const d = createButtonEdgeDetector()
    d.feed(ALL_RELEASED)
    const held = press(CLICK_BUTTON.SHIFT_UP)
    const first = d.feed(held)
    const rest = Array.from({ length: 9 }, () => d.feed(held))
    expect(first.pressed).toEqual(['SHIFT_UP'])
    expect(rest.every((e) => e.pressed.length === 0)).toBe(true)
  })

  test('release is reported once, and a re-press fires again', () => {
    const d = createButtonEdgeDetector()
    d.feed(ALL_RELEASED)
    d.feed(press(CLICK_BUTTON.A))
    expect(d.feed(ALL_RELEASED).released).toEqual(['A'])
    expect(d.feed(press(CLICK_BUTTON.A)).pressed).toEqual(['A'])
  })

  test('a button already held at connect time does NOT fire a phantom press', () => {
    const d = createButtonEdgeDetector()
    const held = press(CLICK_BUTTON.SHIFT_DOWN)
    expect(d.feed(held).pressed).toEqual([]) // first frame is a baseline
    expect(d.feed(held).pressed).toEqual([])
  })

  test('reset re-establishes the baseline', () => {
    const d = createButtonEdgeDetector()
    d.feed(ALL_RELEASED)
    d.reset()
    expect(d.feed(press(CLICK_BUTTON.B)).pressed).toEqual([])
  })
})

describe('clickBindings', () => {
  test('the paddles default to shifting', () => {
    expect(DEFAULT_CLICK_BINDINGS.SHIFT_UP).toBe('shiftUp')
    expect(DEFAULT_CLICK_BINDINGS.SHIFT_DOWN).toBe('shiftDown')
  })

  test('every button has a default entry', () => {
    for (const id of ALL_CLICK_BUTTONS) {
      expect(DEFAULT_CLICK_BINDINGS[id]).toBeDefined()
    }
  })

  test('stored bindings merge over defaults and drop unknown entries', () => {
    const merged = normaliseClickBindings({ A: 'lapMarker', GHOST: 'shiftUp', B: 'nonsense' })
    expect(merged.A).toBe('lapMarker')
    expect(merged).not.toHaveProperty('GHOST')
    expect(merged.B).toBe(DEFAULT_CLICK_BINDINGS.B) // invalid action falls back
    expect(merged.SHIFT_UP).toBe('shiftUp') // untouched default survives
  })

  test('an empty or junk stored key map falls back to defaults rather than unbinding all', () => {
    expect(normaliseKeyBindings({})).toEqual(DEFAULT_KEY_BINDINGS)
    expect(normaliseKeyBindings(null)).toEqual(DEFAULT_KEY_BINDINGS)
    expect(normaliseKeyBindings({ x: 'not-an-action' })).toEqual(DEFAULT_KEY_BINDINGS)
  })

  test('a renamed action is migrated, not dropped', () => {
    // 'startPause' shipped before the rename. Dropping it would silently unbind Space and
    // the A button for anyone with existing settings.
    expect(normaliseKeyBindings({ ' ': 'startPause', ']': 'shiftUp' })[' ']).toBe('startWorkout')
    expect(normaliseClickBindings({ A: 'startPause' }).A).toBe('startWorkout')
  })

  test('a genuinely unknown action is still dropped', () => {
    expect(normaliseKeyBindings({ ' ': 'teleport', ']': 'shiftUp' })[' ']).toBeUndefined()
  })

  test('binding a key steals it from whatever held it', () => {
    const next = bindKey(DEFAULT_KEY_BINDINGS, ']', 'lapMarker')
    expect(next[']']).toBe('lapMarker')
    expect(keyForAction(next, 'shiftUp')).toBeNull()
  })

  test('binding to "none" clears the key', () => {
    const next = bindKey(DEFAULT_KEY_BINDINGS, ']', 'none')
    expect(next[']']).toBeUndefined()
    expect(actionForKey(next, ']')).toBe('none')
  })

  test('no key is ever bound to two actions', () => {
    const keys = Object.keys(DEFAULT_KEY_BINDINGS)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('the only action unreachable by default is the destructive one', () => {
    // endWorkout is deliberately unbound: it is irreversible, and one stray keypress
    // mid-ride would bin the session. Everything else must be reachable out of the box.
    expect(unreachableActions(DEFAULT_CLICK_BINDINGS, DEFAULT_KEY_BINDINGS)).toEqual(['endWorkout'])
  })

  test('stranding an action is reported', () => {
    const stripped = bindKey(DEFAULT_KEY_BINDINGS, 'l', 'none')
    const noLap = { ...DEFAULT_CLICK_BINDINGS }
    expect(unreachableActions(noLap, stripped)).toContain('lapMarker')
  })
})

describe('clickButtons — frame parsing', () => {
  const bytes = (hex) => Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)))

  test('decodes the all-released frame captured from hardware', () => {
    const f = parseClickFrame(bytes('23 08 ff ff ff ff 0f'))
    expect(f).toEqual({ type: 'buttons', bitmap: 0xffffffff })
  })

  test('the bitmap stays unsigned — 0xFFFFFFFF must not become -1', () => {
    const { bitmap } = parseClickFrame(bytes('23 08 ff ff ff ff 0f'))
    expect(bitmap).toBe(4294967295)
    expect(bitmap > 0).toBe(true)
  })

  test('decodes real paddle frames', () => {
    expect(parseClickFrame(bytes('23 08 ff df ff ff 0f')).bitmap).toBe(0xffffefff) // "+"
    expect(parseClickFrame(bytes('23 08 ff fd ff ff 0f')).bitmap).toBe(0xfffffeff) // "−"
    expect(pressedButtons(parseClickFrame(bytes('23 08 ff fd ff ff 0f')).bitmap)).toEqual([
      'SHIFT_DOWN',
    ])
  })

  test('battery, initial-status and 0xFF status frames are recognised', () => {
    expect(parseClickFrame(bytes('19 10 64'))).toEqual({ type: 'battery', level: 0x64 })
    expect(parseClickFrame(bytes('2a 08 03 12 11')).type).toBe('initialStatus')
    expect(parseClickFrame(bytes('ff 05 00 fa 05 12')).type).toBe('status')
  })

  test('an unknown message type is reported, not silently dropped', () => {
    expect(parseClickFrame(bytes('77 01 02'))).toEqual({ type: 'other', messageType: 0x77 })
  })

  test('an empty buffer yields null', () => {
    expect(parseClickFrame(new Uint8Array())).toBeNull()
  })

  test('varint decoding matches protobuf base-128', () => {
    expect(decodeVarint(bytes('00'), 0).value).toBe(0)
    expect(decodeVarint(bytes('7f'), 0).value).toBe(127)
    expect(decodeVarint(bytes('80 01'), 0).value).toBe(128)
    expect(decodeVarint(bytes('ff ff ff ff 0f'), 0).value).toBe(4294967295)
    expect(decodeVarint(bytes('80 01'), 0).next).toBe(2)
  })
})
