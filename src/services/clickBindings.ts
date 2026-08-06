/**
 * What each Zwift Click button does, and the keyboard equivalent for each action.
 *
 * Two independent layers, deliberately:
 *
 *   Click button ──► ACTION ◄── keyboard key
 *
 * Binding both sides to a shared action vocabulary rather than wiring buttons straight to
 * keys means the app has exactly one place that knows what "shift up" means, a keyboard-only
 * user gets the same features as a Click user, and either side can be remapped without
 * touching the other.
 */

import type { ClickButtonId } from './clickButtons'
import { ALL_CLICK_BUTTONS } from './clickButtons'

export type ClickAction =
  | 'shiftUp'
  | 'shiftDown'
  | 'startWorkout'
  | 'endWorkout'
  | 'nextStep'
  | 'previousStep'
  | 'increaseTarget'
  | 'decreaseTarget'
  | 'toggleErgSim'
  | 'lapMarker'
  | 'none'

export const CLICK_ACTION_LABEL: Record<ClickAction, string> = {
  shiftUp: 'Shift up (harder)',
  shiftDown: 'Shift down (easier)',
  startWorkout: 'Start workout',
  endWorkout: 'End workout',
  nextStep: 'Next workout step',
  previousStep: 'Previous workout step',
  increaseTarget: 'Increase target',
  decreaseTarget: 'Decrease target',
  toggleErgSim: 'Toggle ERG / SIM',
  lapMarker: 'Mark lap',
  none: '— not assigned —',
}

export const ALL_CLICK_ACTIONS = Object.keys(CLICK_ACTION_LABEL) as ClickAction[]

export type ClickBindings = Record<ClickButtonId, ClickAction>
export type KeyBindings = Record<string, ClickAction>

/**
 * Defaults. The paddles map to shifting because that is what they are physically for; the
 * D-pad drives workout navigation because it is on the same unit as the "−" paddle and its
 * directions read naturally as prev/next. Face buttons start unassigned rather than being
 * given a guess the user then has to discover and undo.
 */
export const DEFAULT_CLICK_BINDINGS: ClickBindings = {
  SHIFT_UP: 'shiftUp',
  SHIFT_DOWN: 'shiftDown',
  DPAD_UP: 'increaseTarget',
  DPAD_DOWN: 'decreaseTarget',
  DPAD_RIGHT: 'nextStep',
  DPAD_LEFT: 'previousStep',
  A: 'startWorkout',
  B: 'none',
  Y: 'none',
  Z: 'none',
}

/**
 * Keyboard equivalents, so every Click action is reachable without the hardware.
 *
 * `endWorkout` deliberately has NO default key. It is destructive and irreversible, and a
 * stray keypress mid-ride would bin the session — the user can assign one if they want it. Chosen to
 * mirror the physical layout: arrows for the D-pad, and the bracket keys for the paddles
 * because they sit where shifters do on a keyboard-as-handlebar mental model.
 *
 * Keys are matched against KeyboardEvent.key, verbatim and case-sensitively for printable
 * characters.
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  ']': 'shiftUp',
  '[': 'shiftDown',
  ArrowUp: 'increaseTarget',
  ArrowDown: 'decreaseTarget',
  ArrowRight: 'nextStep',
  ArrowLeft: 'previousStep',
  ' ': 'startWorkout',
  e: 'toggleErgSim',
  l: 'lapMarker',
}

/** The key currently bound to an action, if any — for showing shortcuts in the UI. */
export function keyForAction(bindings: KeyBindings, action: ClickAction): string | null {
  const found = Object.entries(bindings).find(([, a]) => a === action)
  return found ? found[0] : null
}

/** `KeyboardEvent.key` values that would render as nothing useful on their own. */
const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: '⏎',
  Tab: 'Tab',
}

/**
 * A `KeyboardEvent.key` rendered for display on a shortcut chip.
 *
 * Printable single characters are shown VERBATIM, deliberately not upper-cased. Keycaps are
 * conventionally drawn uppercase, but `actionForKey` matches case-sensitively — so rendering
 * the binding `e` as "E" would tell the rider to press Shift+E, which produces the key `E` and
 * matches nothing. The convention loses to being correct.
 */
export function formatKeyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

export function actionForKey(bindings: KeyBindings, key: string): ClickAction {
  return bindings[key] ?? 'none'
}

export function actionForButton(bindings: ClickBindings, id: ClickButtonId): ClickAction {
  return bindings[id] ?? 'none'
}

/**
 * Actions that have been renamed. Stored settings outlive the code that wrote them, so a
 * rename must be migrated rather than treated as an unknown value and dropped — dropping it
 * silently unbinds the key, which is how a user loses Space for "start workout" without ever
 * touching the settings.
 */
const RENAMED_ACTIONS: Record<string, ClickAction> = {
  startPause: 'startWorkout',
}

function migrateAction(action: unknown): ClickAction | null {
  if (typeof action !== 'string') return null
  const renamed = RENAMED_ACTIONS[action]
  if (renamed) return renamed
  return ALL_CLICK_ACTIONS.includes(action as ClickAction) ? (action as ClickAction) : null
}

/**
 * Merge stored bindings over the defaults, dropping anything unrecognised.
 *
 * Persisted settings outlive the code that wrote them: a button or action removed in a later
 * version must not resurrect itself from localStorage, and a newly-added button must pick up
 * its default rather than being silently unbound.
 */
export function normaliseClickBindings(stored: unknown): ClickBindings {
  const out = { ...DEFAULT_CLICK_BINDINGS }
  if (!stored || typeof stored !== 'object') return out
  for (const [button, action] of Object.entries(stored as Record<string, unknown>)) {
    if (!ALL_CLICK_BUTTONS.includes(button as ClickButtonId)) continue
    const migrated = migrateAction(action)
    if (!migrated) continue
    out[button as ClickButtonId] = migrated
  }
  return out
}

export function normaliseKeyBindings(stored: unknown): KeyBindings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_KEY_BINDINGS }
  const out: KeyBindings = {}
  for (const [key, action] of Object.entries(stored as Record<string, unknown>)) {
    const migrated = key ? migrateAction(action) : null
    if (!migrated) continue
    out[key] = migrated
  }
  // An empty or entirely invalid stored object means "never configured", not "unbind
  // everything" — the latter would leave a user with no keyboard control and no way back.
  return Object.keys(out).length ? out : { ...DEFAULT_KEY_BINDINGS }
}

/**
 * Assign a key to an action, removing whatever else held that key.
 *
 * One key cannot drive two actions: allowing it makes behaviour depend on object key order,
 * which is exactly the kind of bug that only shows up on someone else's machine.
 */
export function bindKey(bindings: KeyBindings, key: string, action: ClickAction): KeyBindings {
  const out: KeyBindings = {}
  for (const [k, a] of Object.entries(bindings)) {
    if (k !== key) out[k] = a
  }
  if (action !== 'none') out[key] = action
  return out
}

/** Actions with no way to trigger them — surfaced in the UI so a remap can't strand a feature. */
export function unreachableActions(
  clickBindings: ClickBindings,
  keyBindings: KeyBindings
): ClickAction[] {
  const bound = new Set<ClickAction>([
    ...Object.values(clickBindings),
    ...Object.values(keyBindings),
  ])
  return ALL_CLICK_ACTIONS.filter((a) => a !== 'none' && !bound.has(a))
}
