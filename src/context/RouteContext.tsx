import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { GarminRoute, RouteDataPoint, WorkoutStep, SavedWorkoutEntry } from '../types.js'
import {
  loadRoute,
  saveRoute as persistRoute,
  clearRoute as deleteRoute,
  loadWorkoutPlan,
  saveWorkoutPlan as persistPlan,
  clearWorkoutPlan,
  getSavedList,
  saveToList,
  loadFromList,
  deleteFromList,
} from '../services/storage.js'
import { preprocessRouteData } from '../services/routeService.js'

/**
 * RouteContext — garmin route, preprocessed route data, and workout plan.
 *
 * State is initialised from localStorage on mount via storage.js.
 * All mutations go through storage.js so they persist across page loads.
 * This context has no dependency on main.js or window.Hybrid.
 */

interface RouteContextValue {
  route: GarminRoute | null
  preprocessedRoute: RouteDataPoint[]
  workoutPlan: WorkoutStep[]
  importRoute: (routeObj: GarminRoute) => void
  removeRoute: () => void
  addStep: (step: WorkoutStep) => void
  removeStep: (index: number) => void
  clearPlan: () => void
  replacePlan: (plan: WorkoutStep[]) => void
  saveWorkout: (name: string, data: { plan: WorkoutStep[]; routeName?: string }) => void
  loadWorkout: (name: string) => SavedWorkoutEntry | null
  deleteWorkout: (name: string) => void
  getSavedWorkouts: () => string[]
}

const RouteContext = createContext<RouteContextValue | null>(null)

function initRoute(): { route: GarminRoute | null; preprocessedRoute: RouteDataPoint[] } {
  const r = loadRoute()
  return {
    route: r,
    preprocessedRoute: r ? preprocessRouteData(r.geoPoints) : [],
  }
}

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const [{ route, preprocessedRoute }, setRouteState] = useState(initRoute)
  const [workoutPlan, setWorkoutPlan] = useState<WorkoutStep[]>(() => loadWorkoutPlan())

  // Sync when main.js saves a route or mutates the workout plan (bridge — removed in Step 8)
  useEffect(() => {
    const onRouteLoaded = () => {
      const r = loadRoute()
      if (r) setRouteState({ route: r, preprocessedRoute: preprocessRouteData(r.geoPoints) })
    }
    const onPlanUpdated = () => setWorkoutPlan(loadWorkoutPlan())
    window.addEventListener('routeLoaded', onRouteLoaded)
    window.addEventListener('workoutPlanUpdated', onPlanUpdated)
    return () => {
      window.removeEventListener('routeLoaded', onRouteLoaded)
      window.removeEventListener('workoutPlanUpdated', onPlanUpdated)
    }
  }, [])

  // ── Route ────────────────────────────────────────────────────────────────

  const importRoute = useCallback((routeObj: GarminRoute) => {
    const processed = preprocessRouteData(routeObj.geoPoints)
    setRouteState({ route: routeObj, preprocessedRoute: processed })
    persistRoute(routeObj)
  }, [])

  const removeRoute = useCallback(() => {
    setRouteState({ route: null, preprocessedRoute: [] })
    deleteRoute()
  }, [])

  // ── Workout plan ─────────────────────────────────────────────────────────

  const addStep = useCallback((step: WorkoutStep) => {
    setWorkoutPlan((prev) => {
      const next = [...prev, step]
      persistPlan(next)
      return next
    })
  }, [])

  const removeStep = useCallback((index: number) => {
    setWorkoutPlan((prev) => {
      const next = prev.filter((_, i) => i !== index)
      persistPlan(next)
      return next
    })
  }, [])

  const clearPlan = useCallback(() => {
    setWorkoutPlan([])
    clearWorkoutPlan()
  }, [])

  const replacePlan = useCallback((plan: WorkoutStep[]) => {
    setWorkoutPlan(plan)
    persistPlan(plan)
  }, [])

  // ── Named saved workouts ─────────────────────────────────────────────────

  const saveWorkout = useCallback(
    (name: string, data: { plan: WorkoutStep[]; routeName?: string }) => {
      saveToList(name, data)
    },
    []
  )

  const loadWorkout = useCallback((name: string) => {
    return loadFromList(name)
  }, [])

  const deleteWorkout = useCallback((name: string) => {
    deleteFromList(name)
  }, [])

  const getSavedWorkouts = useCallback(() => {
    return getSavedList()
  }, [])

  return (
    <RouteContext.Provider
      value={{
        // state
        route,
        preprocessedRoute,
        workoutPlan,
        // route actions
        importRoute,
        removeRoute,
        // plan actions
        addStep,
        removeStep,
        clearPlan,
        replacePlan,
        // saved workouts
        saveWorkout,
        loadWorkout,
        deleteWorkout,
        getSavedWorkouts,
      }}
    >
      {children}
    </RouteContext.Provider>
  )
}

export const useRoute = () => {
  const ctx = useContext(RouteContext)
  if (!ctx) throw new Error('useRoute must be used inside <RouteProvider>')
  return ctx
}
