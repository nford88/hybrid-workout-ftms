/**
 * The single place that knows what a Click button or key actually DOES.
 *
 * Both input layers (Click buttons, keyboard) resolve to a `ClickAction` and then land here.
 * The registry is explicit about which actions are wired to something real and which are only
 * declared, because the failure mode this prevents is nasty: a binding that looks configured,
 * shows up in the UI, and silently does nothing on the bike.
 *
 * `IMPLEMENTED_ACTIONS` is asserted by tests/unit/click-actions.test.js, so adding an action
 * to the vocabulary without wiring it — or wiring one without updating the list — fails CI
 * rather than being discovered mid-ride.
 */

import type { ClickAction } from './clickBindings'
import { shiftUp, shiftDown, getVirtualGear } from './virtualGearState'

interface LegacyBridge {
  state?: { workout?: { currentGrade?: number; isRunning?: boolean } }
  sim?: { setSimGrade?: (grade: number, opts?: { forceUpdate?: boolean }) => void }
  workout?: { startWorkout?: () => void; skipStep?: () => void; endWorkout?: () => void }
}

function hybrid(): LegacyBridge | undefined {
  return (window as unknown as { Hybrid?: LegacyBridge }).Hybrid
}

/**
 * Re-send the current route grade immediately, bypassing the SIM pipeline's 3-second
 * throttle, so a shift is felt now rather than up to three seconds later (DESIGN §4.3).
 */
function applyShiftNow(): void {
  const H = hybrid()
  const grade = H?.state?.workout?.currentGrade
  if (typeof grade === 'number' && H?.sim?.setSimGrade) {
    H.sim.setSimGrade(grade, { forceUpdate: true })
  }
}

export interface ActionResult {
  action: ClickAction
  performed: boolean
  detail: string
}

/**
 * Actions with a real implementation. Everything else in `ClickAction` is vocabulary the UI
 * can offer but nothing performs yet — deliberately listed so the gap is visible.
 */
export const IMPLEMENTED_ACTIONS: readonly ClickAction[] = [
  'shiftUp',
  'shiftDown',
  'startWorkout',
  'endWorkout',
  'nextStep',
] as const

export function isImplemented(action: ClickAction): boolean {
  return IMPLEMENTED_ACTIONS.includes(action)
}

export function dispatchAction(action: ClickAction): ActionResult {
  switch (action) {
    case 'none':
      return { action, performed: false, detail: 'not assigned' }

    case 'shiftUp':
    case 'shiftDown': {
      const before = getVirtualGear().gearIndex
      const gear = action === 'shiftUp' ? shiftUp() : shiftDown()
      applyShiftNow()
      if (gear.gearIndex === before) {
        // Logged, not silent: an end-stop press feels identical to a dropped button press.
        console.log(`[GEAR] ${action} ignored — already at ${before + 1}/24`)
        return { action, performed: false, detail: `already at the end of the range` }
      }
      // Shifts left NO trace in the 2026-07-29 console log, so a ride that used gears 1-15
      // was indistinguishable from one stuck in a single gear. Log every one.
      console.log(
        `[GEAR] ${before + 1} -> ${gear.gearIndex + 1}/24  ratio ${gear.gearRatio.toFixed(2)} ` +
          `(phys ${gear.physicalRatio.toFixed(2)})`
      )
      return {
        action,
        performed: true,
        detail: `gear ${gear.gearIndex + 1}/24 (ratio ${gear.gearRatio.toFixed(2)})`,
      }
    }

    case 'startWorkout': {
      const H = hybrid()
      // There is no pause in this build — the legacy layer has start and end only, and the
      // workout timers hold absolute durations that a pause would have to unwind. So this
      // starts a stopped workout and says so if one is already running, rather than
      // pretending to toggle.
      if (H?.state?.workout?.isRunning) {
        return { action, performed: false, detail: 'already running — this build has no pause' }
      }
      if (!H?.workout?.startWorkout) {
        return { action, performed: false, detail: 'workout controls not ready' }
      }
      H.workout.startWorkout()
      return { action, performed: true, detail: 'workout started' }
    }

    case 'endWorkout': {
      const H = hybrid()
      if (!H?.state?.workout?.isRunning) {
        return { action, performed: false, detail: 'no workout running' }
      }
      if (!H?.workout?.endWorkout) {
        return { action, performed: false, detail: 'workout controls not ready' }
      }
      H.workout.endWorkout()
      return { action, performed: true, detail: 'workout ended' }
    }

    case 'nextStep': {
      const H = hybrid()
      if (!H?.workout?.skipStep) {
        return { action, performed: false, detail: 'workout controls not ready' }
      }
      H.workout.skipStep()
      return { action, performed: true, detail: 'skipped to the next step' }
    }

    default:
      return { action, performed: false, detail: 'no handler yet' }
  }
}
