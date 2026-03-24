import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { StepSummary } from '../types.js'

/**
 * WorkoutContext — active workout state and control actions.
 *
 * isRunning / currentStepIndex are kept in sync via the custom events that
 * main.js dispatches ('workoutStarted', 'workoutEnded', 'workoutStepChanged').
 *
 * Actions (startWorkout, skipStep, endWorkout) delegate to
 * window.Hybrid.handlers while main.js is present.  Step 8 will replace the
 * bridge with direct context-owned logic.
 */

interface WorkoutContextValue {
  isRunning: boolean
  currentStepIndex: number
  stepStartTime: number | null
  workoutStartTime: number | null
  simDistanceTraveled: number
  stepSimDistance: number
  routeCompleted: boolean
  stepSummary: StepSummary[]
  startWorkout: () => void
  skipStep: () => void
  endWorkout: () => void
}

const WorkoutContext = createContext<WorkoutContextValue | null>(null)

export function WorkoutProvider({ children }: { children: React.ReactNode }) {
  const [isRunning, setIsRunning] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [stepStartTime, setStepStartTime] = useState<number | null>(null)
  const [workoutStartTime, setWorkoutStartTime] = useState<number | null>(null)
  const [simDistanceTraveled, setSimDistanceTraveled] = useState(0)
  const [stepSimDistance, setStepSimDistance] = useState(0)
  const [routeCompleted, setRouteCompleted] = useState(false)
  const [stepSummary, setStepSummary] = useState<StepSummary[]>([])

  // ── Sync with main.js custom events ─────────────────────────────────────

  useEffect(() => {
    const onStart = () => {
      setIsRunning(true)
      setCurrentStepIndex(0)
      setStepSummary([])
      setWorkoutStartTime(Date.now())
      setStepStartTime(Date.now())
      setSimDistanceTraveled(0)
      setStepSimDistance(0)
      setRouteCompleted(false)
    }

    const onEnd = () => {
      setIsRunning(false)
    }

    const onStepChanged = (e: Event) => {
      if ((e as CustomEvent<{ stepIndex: number }>).detail?.stepIndex !== undefined) {
        setCurrentStepIndex((e as CustomEvent<{ stepIndex: number }>).detail.stepIndex)
        setStepStartTime(Date.now())
        setSimDistanceTraveled(0)
        setStepSimDistance(0)
        setRouteCompleted(false)
      }
    }

    const onSimDistance = (e: Event) => {
      if (
        (
          e as CustomEvent<{
            simDistanceTraveled: number
            stepSimDistance?: number
            routeCompleted?: boolean
          }>
        ).detail?.simDistanceTraveled !== undefined
      ) {
        const detail = (
          e as CustomEvent<{
            simDistanceTraveled: number
            stepSimDistance?: number
            routeCompleted?: boolean
          }>
        ).detail
        setSimDistanceTraveled(detail.simDistanceTraveled)
        setStepSimDistance(detail.stepSimDistance ?? 0)
        setRouteCompleted(detail.routeCompleted ?? false)
      }
    }

    window.addEventListener('workoutStarted', onStart)
    window.addEventListener('workoutEnded', onEnd)
    window.addEventListener('workoutStepChanged', onStepChanged)
    window.addEventListener('simDistanceUpdated', onSimDistance)
    return () => {
      window.removeEventListener('workoutStarted', onStart)
      window.removeEventListener('workoutEnded', onEnd)
      window.removeEventListener('workoutStepChanged', onStepChanged)
      window.removeEventListener('simDistanceUpdated', onSimDistance)
    }
  }, [])

  // ── Actions (bridge to main.js; replaced in Step 8) ─────────────────────

  const startWorkout = useCallback(() => {
    ;(window.Hybrid as { handlers?: { startWorkout?: () => void } })?.handlers?.startWorkout?.()
  }, [])

  const skipStep = useCallback(() => {
    ;(window.Hybrid as { handlers?: { skipStep?: () => void } })?.handlers?.skipStep?.()
  }, [])

  const endWorkout = useCallback(() => {
    ;(window.Hybrid as { handlers?: { endWorkout?: () => void } })?.handlers?.endWorkout?.()
  }, [])

  return (
    <WorkoutContext.Provider
      value={{
        isRunning,
        currentStepIndex,
        stepStartTime,
        workoutStartTime,
        simDistanceTraveled,
        stepSimDistance,
        routeCompleted,
        stepSummary,
        startWorkout,
        skipStep,
        endWorkout,
      }}
    >
      {children}
    </WorkoutContext.Provider>
  )
}

export const useWorkout = () => {
  const ctx = useContext(WorkoutContext)
  if (!ctx) throw new Error('useWorkout must be used inside <WorkoutProvider>')
  return ctx
}
