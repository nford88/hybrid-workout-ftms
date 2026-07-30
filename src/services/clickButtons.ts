/**
 * Zwift Click button decoding — pure, no BLE.
 *
 * The bit map here is the one CONFIRMED on our own hardware on 2026-07-29 by pressing every
 * button in a single labelled session (docs/virtual-shifting/experiments/16 Phase 1). Where
 * it disagrees with the community-sourced table, this wins — notably the "+" paddle, which
 * community sources and our own earlier notes both had at 0x20. It is 0x1000; 0x20 is the B
 * face button. The old value silently wired shift-up to B, so the paddle produced no shift
 * event at all.
 *
 * Frames are ACTIVE-LOW: a CLEARED bit means pressed. All-released is 0xFFFFFFFF.
 */

export const CLICK_BUTTON = {
  DPAD_LEFT: 0x1,
  DPAD_UP: 0x2,
  DPAD_RIGHT: 0x4,
  DPAD_DOWN: 0x8,
  A: 0x10,
  B: 0x20,
  Y: 0x40,
  Z: 0x80,
  SHIFT_DOWN: 0x100, // Left "−" paddle
  SHIFT_UP: 0x1000, // Right "+" paddle
} as const

export type ClickButtonId = keyof typeof CLICK_BUTTON

/** Which physical unit each control lives on, for the pairing walkthrough. */
export const CLICK_UNIT: Record<ClickButtonId, 'left' | 'right'> = {
  DPAD_LEFT: 'left',
  DPAD_UP: 'left',
  DPAD_RIGHT: 'left',
  DPAD_DOWN: 'left',
  SHIFT_DOWN: 'left',
  A: 'right',
  B: 'right',
  Y: 'right',
  Z: 'right',
  SHIFT_UP: 'right',
}

export const CLICK_BUTTON_LABEL: Record<ClickButtonId, string> = {
  DPAD_LEFT: 'D-pad Left',
  DPAD_UP: 'D-pad Up',
  DPAD_RIGHT: 'D-pad Right',
  DPAD_DOWN: 'D-pad Down',
  A: 'A',
  B: 'B',
  Y: 'Y',
  Z: 'Z',
  SHIFT_DOWN: 'Shift down ("−" paddle)',
  SHIFT_UP: 'Shift up ("+" paddle)',
}

export const ALL_CLICK_BUTTONS = Object.keys(CLICK_BUTTON) as ClickButtonId[]

/** Buttons on one physical unit, in the order the walkthrough asks for them. */
export function buttonsForUnit(unit: 'left' | 'right'): ClickButtonId[] {
  return ALL_CLICK_BUTTONS.filter((id) => CLICK_UNIT[id] === unit)
}

/** Decode a bitmap into the set of currently-pressed buttons. */
export function pressedButtons(bitmap: number): ClickButtonId[] {
  return ALL_CLICK_BUTTONS.filter((id) => (bitmap & CLICK_BUTTON[id]) === 0)
}

export function isPressed(bitmap: number, id: ClickButtonId): boolean {
  return (bitmap & CLICK_BUTTON[id]) === 0
}

/** Any bit that is cleared but is not one we have a name for — a new finding, not noise. */
export function unknownPressedBits(bitmap: number): number[] {
  const known = ALL_CLICK_BUTTONS.reduce((acc, id) => acc | CLICK_BUTTON[id], 0)
  const pressed = (~bitmap >>> 0) & 0x3ffff // only the low 18 bits are defined
  const unknown = pressed & ~known
  const out: number[] = []
  for (let i = 0; i < 18; i += 1) {
    const bit = 1 << i
    if (unknown & bit) out.push(bit)
  }
  return out
}

export interface ButtonEdges {
  pressed: ClickButtonId[]
  released: ClickButtonId[]
}

/**
 * Edge detector. The device streams the full bitmap at ~10 Hz while a button is held, so
 * consuming frames directly gives ten "presses" per press. Feed every frame; act on the
 * `pressed` list only.
 */
export function createButtonEdgeDetector(): {
  feed: (bitmap: number) => ButtonEdges
  reset: () => void
} {
  let previous: number | null = null
  return {
    feed(bitmap: number): ButtonEdges {
      const before = previous
      previous = bitmap
      if (before === null) {
        // First frame establishes the baseline. Treating anything held at connect time as a
        // fresh press would fire actions the user never made.
        return { pressed: [], released: [] }
      }
      const pressed = ALL_CLICK_BUTTONS.filter(
        (id) => isPressed(bitmap, id) && !isPressed(before, id)
      )
      const released = ALL_CLICK_BUTTONS.filter(
        (id) => !isPressed(bitmap, id) && isPressed(before, id)
      )
      return { pressed, released }
    },
    reset() {
      previous = null
    },
  }
}

// ── Frame parsing ────────────────────────────────────────────────────────────

/** Protobuf base-128 varint. Returns the value and the offset just past it. */
export function decodeVarint(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let i = start
  while (i < bytes.length) {
    const b = bytes[i]
    i += 1
    // >>> 0 keeps the result unsigned: the button bitmap uses the full 32 bits, and a plain
    // shift would turn 0xFFFFFFFF into -1 and break every mask comparison.
    value = (value + (b & 0x7f) * 2 ** shift) >>> 0
    shift += 7
    if ((b & 0x80) === 0) break
  }
  return { value, next: i }
}

export type ClickFrame =
  | { type: 'buttons'; bitmap: number }
  | { type: 'battery'; level: number }
  | { type: 'initialStatus' }
  | { type: 'status' }
  | { type: 'other'; messageType: number }

/**
 * Decode one ASYNC notification. Byte 0 is the message type (PROTOCOLS.md §1.4).
 *
 * Returns `null` only for an empty buffer — an unrecognised type comes back as `other` so a
 * caller can log it rather than silently dropping a frame we have not seen before.
 */
export function parseClickFrame(bytes: Uint8Array): ClickFrame | null {
  if (!bytes.length) return null
  const messageType = bytes[0]
  if (messageType === 0x23 && bytes.length > 2 && bytes[1] === 0x08) {
    return { type: 'buttons', bitmap: decodeVarint(bytes, 2).value }
  }
  if (messageType === 0x19 && bytes.length >= 3) {
    return { type: 'battery', level: bytes[2] }
  }
  if (messageType === 0x2a) return { type: 'initialStatus' }
  if (messageType === 0xff) return { type: 'status' }
  return { type: 'other', messageType }
}
