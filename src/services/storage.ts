/**
 * storage.ts — Consolidated localStorage service.
 *
 * All keys are defined here. No other module should call localStorage directly.
 * Each domain has explicit read/write functions; JSON handling is done internally.
 */

import type {
  GarminRoute,
  WorkoutStep,
  SavedWorkoutEntry,
  GearSettings,
  RiderPhysicsSettings,
} from '../types.js'
import type { ClickBindings, KeyBindings } from './clickBindings.js'
import { normaliseClickBindings, normaliseKeyBindings } from './clickBindings.js'
import type { DrivetrainConfig } from './virtualDrivetrain.js'
import { DEFAULT_DRIVETRAIN } from './virtualDrivetrain.js'

const KEYS = {
  GARMIN_ROUTE: 'garminRoute',
  WORKOUT_PLAN: 'workoutPlan',
  SAVED_WORKOUTS_INDEX: 'savedWorkoutsIndex',
  SAVED_WORKOUT_PREFIX: 'savedWorkout_',
  USER_FTP: 'userFTP',
  BASELINE_GEAR: 'baselineGear',
  RIDER_WEIGHT_KG: 'riderWeightKg',
  BIKE_WEIGHT_KG: 'bikeWeightKg',
  TIRE_TYPE: 'tireType',
  RIDING_POSITION: 'ridingPosition',
  CLICK_BINDINGS: 'clickBindings',
  KEY_BINDINGS: 'keyBindings',
  DRIVETRAIN: 'drivetrainConfig',
  MEDIA_TARGET: 'mediaTarget',
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

// ── Rider & bike physics settings ─────────────────────────────────────────────

export function loadRiderPhysicsSettings(): RiderPhysicsSettings {
  return {
    riderWeightKg: readJSON<number | null>(KEYS.RIDER_WEIGHT_KG, null),
    bikeWeightKg: readJSON<number | null>(KEYS.BIKE_WEIGHT_KG, null),
    tireType: readJSON<string | null>(KEYS.TIRE_TYPE, null),
    ridingPosition: readJSON<string | null>(KEYS.RIDING_POSITION, null),
  }
}

export function saveRiderPhysicsSettings({
  riderWeightKg,
  bikeWeightKg,
  tireType,
  ridingPosition,
}: RiderPhysicsSettings): void {
  writeJSON(KEYS.RIDER_WEIGHT_KG, riderWeightKg)
  writeJSON(KEYS.BIKE_WEIGHT_KG, bikeWeightKg)
  writeJSON(KEYS.TIRE_TYPE, tireType)
  writeJSON(KEYS.RIDING_POSITION, ridingPosition)
}

// ── Zwift Click button + keyboard bindings ───────────────────────────────────
//
// Read back through normalise*() rather than trusted as-is: these outlive the code that
// wrote them, so a button or action removed in a later version must not resurrect itself,
// and a newly-added one must pick up its default instead of being silently unbound.

export function loadClickBindings(): ClickBindings {
  return normaliseClickBindings(readJSON<unknown>(KEYS.CLICK_BINDINGS, null))
}

export function saveClickBindings(bindings: ClickBindings): void {
  writeJSON(KEYS.CLICK_BINDINGS, bindings)
}

export function loadKeyBindings(): KeyBindings {
  return normaliseKeyBindings(readJSON<unknown>(KEYS.KEY_BINDINGS, null))
}

export function saveKeyBindings(bindings: KeyBindings): void {
  writeJSON(KEYS.KEY_BINDINGS, bindings)
}

// ── Physical drivetrain (chainring / cog) ────────────────────────────────────

export function loadDrivetrain(): DrivetrainConfig {
  const stored = readJSON<Partial<DrivetrainConfig> | null>(KEYS.DRIVETRAIN, null)
  const chainringTeeth = Number(stored?.chainringTeeth)
  const cogTeeth = Number(stored?.cogTeeth)
  // Teeth counts outside these bounds are a typo or corrupted storage, not a drivetrain —
  // and a zero cog would divide by zero in the ratio.
  return {
    chainringTeeth:
      chainringTeeth >= 20 && chainringTeeth <= 60
        ? chainringTeeth
        : DEFAULT_DRIVETRAIN.chainringTeeth,
    cogTeeth: cogTeeth >= 9 && cogTeeth <= 40 ? cogTeeth : DEFAULT_DRIVETRAIN.cogTeeth,
  }
}

export function saveDrivetrain(config: DrivetrainConfig): void {
  writeJSON(KEYS.DRIVETRAIN, config)
}

// ── Ride video (YouTube playlist or single video) ─────────────────────────────
//
// The raw pasted string is stored, not the parsed object, and re-parsed on read. Parsing rules
// change (new URL shapes, tighter host checks) and a stored parse would be frozen at whatever the
// rules were the day it was saved — re-parsing means a fix reaches old values too. It also means a
// value that stops being valid degrades to "nothing configured" rather than to a broken player.

export function loadMediaInput(): string {
  const raw = readJSON<unknown>(KEYS.MEDIA_TARGET, null)
  return typeof raw === 'string' ? raw : ''
}

export function saveMediaInput(input: string): void {
  writeJSON(KEYS.MEDIA_TARGET, input)
}
