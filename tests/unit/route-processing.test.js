import { describe, test, expect, beforeEach } from 'vitest'
import { preprocessRouteData, getGradeForDistance } from '../../src/services/routeService'

describe('preprocessRouteData', () => {
  test('handles empty geoPoints array', () => {
    expect(preprocessRouteData([])).toEqual([])
  })

  test('handles single point', () => {
    const geoPoints = [{ latitude: 40.7128, longitude: -74.006, elevation: 10 }]
    expect(preprocessRouteData(geoPoints)).toEqual([{ distance: 0, elevation: 10, grade: 0 }])
  })

  test('calculates distances and grades correctly for simple route', () => {
    const geoPoints = [
      { latitude: 40.7128, longitude: -74.006, elevation: 10 },
      { latitude: 40.7589, longitude: -73.9851, elevation: 20 },
      { latitude: 40.7505, longitude: -73.9934, elevation: 15 },
    ]
    const result = preprocessRouteData(geoPoints)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ distance: 0, elevation: 10, grade: 0 })
    expect(result[1].distance).toBeGreaterThan(0)
    expect(result[1].elevation).toBe(20)
    expect(result[1].grade).toBeGreaterThan(0) // uphill
    expect(result[2].distance).toBeGreaterThan(result[1].distance)
    expect(result[2].elevation).toBe(15)
    expect(result[2].grade).toBeLessThan(0) // downhill
  })

  test('handles flat route correctly', () => {
    const geoPoints = [
      { latitude: 40.0, longitude: -74.0, elevation: 100 },
      { latitude: 40.1, longitude: -74.0, elevation: 100 },
      { latitude: 40.2, longitude: -74.0, elevation: 100 },
    ]
    const result = preprocessRouteData(geoPoints)
    expect(result[1].grade).toBe(0)
    expect(result[2].grade).toBe(0)
  })

  test('calculates cumulative distances correctly', () => {
    const geoPoints = [
      { latitude: 40.0, longitude: -74.0, elevation: 0 },
      { latitude: 40.1, longitude: -74.0, elevation: 0 },
      { latitude: 40.2, longitude: -74.0, elevation: 0 },
    ]
    const result = preprocessRouteData(geoPoints)
    expect(result[0].distance).toBe(0)
    expect(result[1].distance).toBeGreaterThan(0)
    expect(result[2].distance).toBeGreaterThan(result[1].distance)
  })
})

describe('getGradeForDistance', () => {
  let testRoute

  beforeEach(() => {
    testRoute = [
      { distance: 0, elevation: 0, grade: 0 },
      { distance: 1000, elevation: 50, grade: 5 },
      { distance: 2000, elevation: 50, grade: 0 },
      { distance: 3000, elevation: 20, grade: -3 },
      { distance: 4000, elevation: 20, grade: 0 },
    ]
  })

  test('returns 0 for empty or null route', () => {
    expect(getGradeForDistance(1000, [])).toBe(0)
    expect(getGradeForDistance(1000, null)).toBe(0)
    expect(getGradeForDistance(1000, undefined)).toBe(0)
  })

  test('returns first grade for negative distance', () => {
    expect(getGradeForDistance(-100, testRoute)).toBe(0)
  })

  test('returns last grade for distance beyond route', () => {
    expect(getGradeForDistance(5000, testRoute)).toBe(0)
  })

  test('returns correct grade at distance points', () => {
    // distance <= 0 → first grade
    expect(getGradeForDistance(0, testRoute)).toBe(0)
    // exactly at a waypoint → grade of the NEXT segment (looking ahead)
    expect(getGradeForDistance(1000, testRoute)).toBe(0) // entering flat section
    expect(getGradeForDistance(2000, testRoute)).toBe(-3) // entering downhill
    expect(getGradeForDistance(3000, testRoute)).toBe(0) // entering flat
    // distance >= last → last grade
    expect(getGradeForDistance(4000, testRoute)).toBe(0)
  })

  test('returns correct grade between distance points', () => {
    expect(getGradeForDistance(500, testRoute)).toBe(5)
    expect(getGradeForDistance(1500, testRoute)).toBe(0)
    expect(getGradeForDistance(2500, testRoute)).toBe(-3)
  })

  test('handles distance exactly at route end', () => {
    expect(getGradeForDistance(4000, testRoute)).toBe(0)
  })
})

describe('Route integration', () => {
  test('preprocessed route works with getGradeForDistance', () => {
    const geoPoints = [
      { latitude: 37.7749, longitude: -122.4194, elevation: 0 },
      { latitude: 37.7849, longitude: -122.4094, elevation: 100 },
      { latitude: 37.7949, longitude: -122.3994, elevation: 150 },
      { latitude: 37.8049, longitude: -122.3894, elevation: 50 },
      { latitude: 37.8149, longitude: -122.3794, elevation: 0 },
    ]
    const processed = preprocessRouteData(geoPoints)

    expect(getGradeForDistance(0, processed)).toBe(0)
    expect(typeof getGradeForDistance(processed[2].distance, processed)).toBe('number')

    const allGrades = processed.map((p) => p.grade)
    expect(allGrades.some((g) => g > 0)).toBe(true)
    expect(allGrades.some((g) => g < 0)).toBe(true)
  })

  test('realistic route data structure', () => {
    const geoPoints = [
      { latitude: 51.1234, longitude: -0.5678, elevation: 100 },
      { latitude: 51.1244, longitude: -0.5688, elevation: 120 },
      { latitude: 51.1254, longitude: -0.5698, elevation: 140 },
      { latitude: 51.1354, longitude: -0.5798, elevation: 110 },
    ]
    const processed = preprocessRouteData(geoPoints)
    expect(processed.length).toBeGreaterThan(0)
    expect(processed[0].distance).toBe(0)
    expect(processed[0].grade).toBe(0)
    expect(processed[processed.length - 1].distance).toBeGreaterThan(0)
    expect(processed[processed.length - 1].distance).toBeLessThan(50000)
  })
})
