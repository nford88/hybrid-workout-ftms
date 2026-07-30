import { describe, test, expect, beforeEach } from 'vitest'
import { dispatchAction, isImplemented, IMPLEMENTED_ACTIONS } from '../../src/services/clickActions'
import {
  ALL_CLICK_ACTIONS,
  DEFAULT_CLICK_BINDINGS,
  DEFAULT_KEY_BINDINGS,
  actionForKey,
  actionForButton,
} from '../../src/services/clickBindings'
import { ALL_CLICK_BUTTONS, CLICK_BUTTON } from '../../src/services/clickButtons'
import { getVirtualGear, resetVirtualGear, setGearIndex } from '../../src/services/virtualGearState'

/**
 * The point of this file: prove that pressing a Click button or a key reaches something real.
 * A binding that is configured, displayed, and does nothing is the failure this catches.
 */

function fakeHybrid({ isRunning = false } = {}) {
  const calls = []
  window.Hybrid = {
    state: { workout: { currentGrade: 4.2, isRunning } },
    sim: { setSimGrade: (g, o) => calls.push(['setSimGrade', g, o]) },
    workout: {
      startWorkout: () => calls.push(['startWorkout']),
      skipStep: () => calls.push(['skipStep']),
      endWorkout: () => calls.push(['endWorkout']),
    },
  }
  return calls
}

beforeEach(() => {
  resetVirtualGear()
  delete window.Hybrid
})

describe('every action is honestly classified', () => {
  test('the implemented list only contains real actions', () => {
    for (const a of IMPLEMENTED_ACTIONS) {
      expect(ALL_CLICK_ACTIONS).toContain(a)
    }
  })

  test('an implemented action actually performs when the app is ready', () => {
    for (const action of IMPLEMENTED_ACTIONS) {
      // endWorkout needs a RUNNING workout; startWorkout needs a stopped one. Setting the
      // precondition per action is the point — an action that only works from one state
      // should still be provably wired.
      fakeHybrid({ isRunning: action === 'endWorkout' })
      resetVirtualGear()
      setGearIndex(11) // mid-range, so shifts are not blocked by the end stops
      const result = dispatchAction(action)
      expect(`${action}:${result.performed}`).toBe(`${action}:true`)
    }
  })

  test('an UNimplemented action reports that it did nothing — it never silently no-ops', () => {
    fakeHybrid()
    const unimplemented = ALL_CLICK_ACTIONS.filter((a) => a !== 'none' && !isImplemented(a))
    expect(unimplemented.length).toBeGreaterThan(0) // this build genuinely has gaps
    for (const action of unimplemented) {
      const result = dispatchAction(action)
      expect(result.performed).toBe(false)
      expect(result.detail).toBeTruthy()
    }
  })

  test('"none" is inert', () => {
    fakeHybrid()
    expect(dispatchAction('none').performed).toBe(false)
  })
})

describe('shifting — the path that matters for SIM mode', () => {
  test('shift up moves a gear and re-sends the grade immediately', () => {
    const calls = fakeHybrid()
    setGearIndex(11)
    const before = getVirtualGear().gearIndex
    const result = dispatchAction('shiftUp')
    expect(result.performed).toBe(true)
    expect(getVirtualGear().gearIndex).toBe(before + 1)
    // The forced re-send is what makes a shift felt now rather than up to 3 s later.
    expect(calls).toContainEqual(['setSimGrade', 4.2, { forceUpdate: true }])
  })

  test('shift down moves the other way', () => {
    fakeHybrid()
    setGearIndex(11)
    dispatchAction('shiftDown')
    expect(getVirtualGear().gearIndex).toBe(10)
  })

  test('shifting past the end stop reports it instead of pretending', () => {
    fakeHybrid()
    setGearIndex(23)
    const result = dispatchAction('shiftUp')
    expect(result.performed).toBe(false)
    expect(result.detail).toMatch(/end of the range/)
    expect(getVirtualGear().gearIndex).toBe(23)
  })

  test('a shift still changes gear even if the SIM pipeline is not up yet', () => {
    // No window.Hybrid at all — connecting the Click before starting a workout.
    setGearIndex(11)
    const result = dispatchAction('shiftUp')
    expect(result.performed).toBe(true)
    expect(getVirtualGear().gearIndex).toBe(12)
  })
})

describe('workout actions', () => {
  test('startWorkout starts a stopped workout', () => {
    const calls = fakeHybrid({ isRunning: false })
    expect(dispatchAction('startWorkout').performed).toBe(true)
    expect(calls).toContainEqual(['startWorkout'])
  })

  test('startWorkout does NOT restart a running one, and says there is no pause', () => {
    const calls = fakeHybrid({ isRunning: true })
    const result = dispatchAction('startWorkout')
    expect(result.performed).toBe(false)
    expect(result.detail).toMatch(/no pause/)
    expect(calls).not.toContainEqual(['startWorkout'])
  })

  test('endWorkout ends a running workout', () => {
    const calls = fakeHybrid({ isRunning: true })
    expect(dispatchAction('endWorkout').performed).toBe(true)
    expect(calls).toContainEqual(['endWorkout'])
  })

  test('endWorkout does nothing when nothing is running', () => {
    const calls = fakeHybrid({ isRunning: false })
    expect(dispatchAction('endWorkout').performed).toBe(false)
    expect(calls).not.toContainEqual(['endWorkout'])
  })

  test('endWorkout has NO default key — a stray press must not bin a session', () => {
    expect(Object.values(DEFAULT_KEY_BINDINGS)).not.toContain('endWorkout')
    expect(Object.values(DEFAULT_CLICK_BINDINGS)).not.toContain('endWorkout')
  })

  test('nextStep skips a step', () => {
    const calls = fakeHybrid()
    expect(dispatchAction('nextStep').performed).toBe(true)
    expect(calls).toContainEqual(['skipStep'])
  })

  test('actions degrade gracefully before the legacy layer has loaded', () => {
    for (const action of ['startWorkout', 'nextStep']) {
      const result = dispatchAction(action)
      expect(result.performed).toBe(false)
      expect(result.detail).toMatch(/not ready/)
    }
  })
})

describe('the bindings actually reach the dispatcher', () => {
  test('the default Click bindings map the paddles to shifting', () => {
    expect(actionForButton(DEFAULT_CLICK_BINDINGS, 'SHIFT_UP')).toBe('shiftUp')
    expect(actionForButton(DEFAULT_CLICK_BINDINGS, 'SHIFT_DOWN')).toBe('shiftDown')
  })

  test('pressing each default-bound button reaches a real handler or says why not', () => {
    fakeHybrid()
    for (const id of ALL_CLICK_BUTTONS) {
      setGearIndex(11)
      const action = actionForButton(DEFAULT_CLICK_BINDINGS, id)
      const result = dispatchAction(action)
      // Either it did something, or it explained itself. Never silent.
      expect(`${id}:${result.performed || !!result.detail}`).toBe(`${id}:true`)
    }
  })

  test('the default keys for shifting reach the shifter', () => {
    fakeHybrid()
    setGearIndex(11)
    expect(actionForKey(DEFAULT_KEY_BINDINGS, ']')).toBe('shiftUp')
    dispatchAction(actionForKey(DEFAULT_KEY_BINDINGS, ']'))
    expect(getVirtualGear().gearIndex).toBe(12)
    dispatchAction(actionForKey(DEFAULT_KEY_BINDINGS, '['))
    expect(getVirtualGear().gearIndex).toBe(11)
  })

  test('an unbound key resolves to none and does nothing', () => {
    fakeHybrid()
    setGearIndex(11)
    expect(actionForKey(DEFAULT_KEY_BINDINGS, 'q')).toBe('none')
    dispatchAction(actionForKey(DEFAULT_KEY_BINDINGS, 'q'))
    expect(getVirtualGear().gearIndex).toBe(11)
  })

  test('the two paddle bits are the ones the hardware actually sends', () => {
    // Guards against the 0x20-vs-0x1000 regression that wired shiftUp to the B button.
    expect(CLICK_BUTTON.SHIFT_UP).toBe(0x1000)
    expect(CLICK_BUTTON.SHIFT_DOWN).toBe(0x100)
  })
})
