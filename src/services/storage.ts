/**
 * storage.ts — Consolidated localStorage service.
 *
 * All keys are defined here. No other module should call localStorage directly.
 * Each domain has explicit read/write functions; JSON handling is done internally.
 */

import type { GarminRoute, WorkoutStep, SavedWorkoutEntry, GearSettings } from '../types.js'

const KEYS = {
  GARMIN_ROUTE: 'garminRoute',
  WORKOUT_PLAN: 'workoutPlan',
  SAVED_WORKOUTS_INDEX: 'savedWorkoutsIndex',
  SAVED_WORKOUT_PREFIX: 'savedWorkout_',
  USER_FTP: 'userFTP',
  BASELINE_GEAR: 'baselineGear',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

// ── Garmin route ─────────────────────────────────────────────────────────────

export function loadRoute(): GarminRoute | null {
  return readJSON<GarminRoute | null>(KEYS.GARMIN_ROUTE, null)
}

export function saveRoute(route: GarminRoute): void {
  writeJSON(KEYS.GARMIN_ROUTE, route)
}

export function clearRoute(): void {
  localStorage.removeItem(KEYS.GARMIN_ROUTE)
}

// ── Active workout plan ───────────────────────────────────────────────────────

export function loadWorkoutPlan(): WorkoutStep[] {
  return readJSON<WorkoutStep[]>(KEYS.WORKOUT_PLAN, [])
}

export function saveWorkoutPlan(plan: WorkoutStep[]): void {
  writeJSON(KEYS.WORKOUT_PLAN, plan)
}

export function clearWorkoutPlan(): void {
  localStorage.removeItem(KEYS.WORKOUT_PLAN)
}

// ── Named saved workouts ──────────────────────────────────────────────────────

export function getSavedList(): string[] {
  return readJSON<string[]>(KEYS.SAVED_WORKOUTS_INDEX, [])
}

function setSavedList(list: string[]): void {
  writeJSON(KEYS.SAVED_WORKOUTS_INDEX, list)
}

export function saveToList(name: string, data: { plan: WorkoutStep[]; routeName?: string }): void {
  const entry: SavedWorkoutEntry = {
    name,
    plan: data.plan,
    routeName: data.routeName ?? null,
    savedAt: Date.now(),
  }
  writeJSON(KEYS.SAVED_WORKOUT_PREFIX + name, entry)

  const list = getSavedList()
  if (!list.includes(name)) {
    list.push(name)
    setSavedList(list)
  }
}

export function loadFromList(name: string): SavedWorkoutEntry | null {
  return readJSON<SavedWorkoutEntry | null>(KEYS.SAVED_WORKOUT_PREFIX + name, null)
}

export function deleteFromList(name: string): void {
  localStorage.removeItem(KEYS.SAVED_WORKOUT_PREFIX + name)
  const list = getSavedList().filter((n) => n !== name)
  setSavedList(list)
}

// ── Virtual gear settings ─────────────────────────────────────────────────────

export function loadGearSettings(): GearSettings {
  return {
    ftp: readJSON<number | null>(KEYS.USER_FTP, null),
    baselineGear: readJSON<number | null>(KEYS.BASELINE_GEAR, null),
  }
}

export function saveGearSettings({ ftp, baselineGear }: GearSettings): void {
  writeJSON(KEYS.USER_FTP, ftp)
  writeJSON(KEYS.BASELINE_GEAR, baselineGear)
}
