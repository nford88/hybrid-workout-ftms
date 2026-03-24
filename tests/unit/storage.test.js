import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  loadRoute,
  saveRoute,
  clearRoute,
  loadWorkoutPlan,
  saveWorkoutPlan,
  clearWorkoutPlan,
  getSavedList,
  saveToList,
  loadFromList,
  deleteFromList,
  loadGearSettings,
  saveGearSettings,
} from '../../src/services/storage'

// ── In-memory localStorage for these tests ───────────────────────────────────

function makeLocalStorageStub() {
  const store = {}
  return {
    getItem: vi.fn((k) => store[k] ?? null),
    setItem: vi.fn((k, v) => {
      store[k] = String(v)
    }),
    removeItem: vi.fn((k) => {
      delete store[k]
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k])
    }),
    _store: store,
  }
}

let ls
beforeEach(() => {
  ls = makeLocalStorageStub()
  vi.stubGlobal('localStorage', ls)
})

// ── Route ────────────────────────────────────────────────────────────────────

describe('route storage', () => {
  test('loadRoute returns null when nothing stored', () => {
    expect(loadRoute()).toBeNull()
  })

  test('saveRoute / loadRoute round-trip', () => {
    const route = { name: 'Test Route', geoPoints: [{ lat: 1, lon: 2 }] }
    saveRoute(route)
    expect(loadRoute()).toEqual(route)
  })

  test('clearRoute removes the entry', () => {
    saveRoute({ name: 'x' })
    clearRoute()
    expect(loadRoute()).toBeNull()
  })
})

// ── Workout plan ─────────────────────────────────────────────────────────────

describe('workout plan storage', () => {
  test('loadWorkoutPlan returns [] when nothing stored', () => {
    expect(loadWorkoutPlan()).toEqual([])
  })

  test('saveWorkoutPlan / loadWorkoutPlan round-trip', () => {
    const plan = [{ type: 'erg', duration: 10, power: 200 }]
    saveWorkoutPlan(plan)
    expect(loadWorkoutPlan()).toEqual(plan)
  })

  test('clearWorkoutPlan removes the entry', () => {
    saveWorkoutPlan([{ type: 'erg' }])
    clearWorkoutPlan()
    expect(loadWorkoutPlan()).toEqual([])
  })
})

// ── Named saved workouts ──────────────────────────────────────────────────────

describe('saved workouts list', () => {
  test('getSavedList returns [] when nothing stored', () => {
    expect(getSavedList()).toEqual([])
  })

  test('saveToList adds name to index', () => {
    saveToList('Morning Ride', { plan: [{ type: 'erg' }] })
    expect(getSavedList()).toContain('Morning Ride')
  })

  test('saveToList does not duplicate names in index', () => {
    saveToList('Morning Ride', { plan: [] })
    saveToList('Morning Ride', { plan: [{ type: 'erg' }] })
    expect(getSavedList().filter((n) => n === 'Morning Ride')).toHaveLength(1)
  })

  test('saveToList / loadFromList round-trip preserves plan', () => {
    const plan = [{ type: 'erg', duration: 5, power: 150 }]
    saveToList('My Workout', { plan, routeName: 'Alpe du Zwift' })
    const loaded = loadFromList('My Workout')
    expect(loaded.plan).toEqual(plan)
    expect(loaded.routeName).toBe('Alpe du Zwift')
    expect(loaded.savedAt).toBeTruthy()
  })

  test('loadFromList returns null for unknown name', () => {
    expect(loadFromList('ghost')).toBeNull()
  })

  test('deleteFromList removes entry and index reference', () => {
    saveToList('Workout A', { plan: [] })
    saveToList('Workout B', { plan: [] })
    deleteFromList('Workout A')

    expect(getSavedList()).not.toContain('Workout A')
    expect(getSavedList()).toContain('Workout B')
    expect(loadFromList('Workout A')).toBeNull()
  })

  test('multiple workouts co-exist independently', () => {
    saveToList('ERG Day', { plan: [{ type: 'erg', power: 200 }] })
    saveToList('SIM Day', { plan: [{ type: 'sim' }] })

    expect(getSavedList()).toHaveLength(2)
    expect(loadFromList('ERG Day').plan[0].power).toBe(200)
    expect(loadFromList('SIM Day').plan[0].type).toBe('sim')
  })
})

// ── Virtual gear settings ─────────────────────────────────────────────────────

describe('gear settings storage', () => {
  test('loadGearSettings returns nulls when nothing stored', () => {
    expect(loadGearSettings()).toEqual({ ftp: null, baselineGear: null })
  })

  test('saveGearSettings / loadGearSettings round-trip', () => {
    saveGearSettings({ ftp: 250, baselineGear: 5 })
    expect(loadGearSettings()).toEqual({ ftp: 250, baselineGear: 5 })
  })

  test('saving new settings overwrites old ones', () => {
    saveGearSettings({ ftp: 200, baselineGear: 3 })
    saveGearSettings({ ftp: 280, baselineGear: 5 })
    expect(loadGearSettings()).toEqual({ ftp: 280, baselineGear: 5 })
  })
})
