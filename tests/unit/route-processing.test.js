// Tests for route processing functions
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createTestEnvironment } from '../test-utils.js'

describe('Route Processing Functions', () => {
  let testEnv

  beforeEach(() => {
    testEnv = createTestEnvironment()
    testEnv.resetState()
  })

  // Copy the functions from the HTML file for testing
  function preprocessRouteData(geoPoints) {
    const H = global.Hybrid
    const out = []
    let total = 0
    if (geoPoints.length) out.push({ distance: 0, elevation: geoPoints[0].elevation, grade: 0 })
    for (let i = 0; i < geoPoints.length - 1; i++) {
      const p1 = geoPoints[i], p2 = geoPoints[i + 1]
      const seg = H.utils.haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
      total += seg
      const elevΔ = p2.elevation - p1.elevation
      const grade = seg > 0 ? (elevΔ / seg) * 100 : 0
      out.push({ distance: total, elevation: p2.elevation, grade })
    }
    return out
  }

  function getGradeForDistance(distance, routeData) {
    const arr = routeData || global.Hybrid.state.preprocessedRoute
    if (!arr || !arr.length) return 0
    if (distance <= 0) return arr[0].grade
    if (distance >= arr[arr.length - 1].distance) return arr[arr.length - 1].grade
    
    // Check for exact distance match first
    const exactMatch = arr.find(point => point.distance === distance)
    if (exactMatch) return exactMatch.grade
    
    // Find the segment we're currently in
    for (let i = 0; i < arr.length - 1; i++) {
      if (distance > arr[i].distance && distance < arr[i + 1].distance) {
        return arr[i + 1].grade // Return the grade of the segment we're entering
      }
    }
    return arr[arr.length - 1].grade // Default to last grade
  }

  describe('preprocessRouteData', () => {
    test('handles empty geoPoints array', () => {
      const result = preprocessRouteData([])
      expect(result).toEqual([])
    })

    test('handles single point', () => {
      const geoPoints = [
        { latitude: 40.7128, longitude: -74.0060, elevation: 10 }
      ]
      const result = preprocessRouteData(geoPoints)
      expect(result).toEqual([
        { distance: 0, elevation: 10, grade: 0 }
      ])
    })

    test('calculates distances and grades correctly for simple route', () => {
      const geoPoints = [
        { latitude: 40.7128, longitude: -74.0060, elevation: 10 },  // Start: NYC
        { latitude: 40.7589, longitude: -73.9851, elevation: 20 },  // Mid: Central Park (higher)
        { latitude: 40.7505, longitude: -73.9934, elevation: 15 }   // End: Times Square (lower)
      ]
      
      const result = preprocessRouteData(geoPoints)
      
      // Should have 3 points
      expect(result).toHaveLength(3)
      
      // First point should be at distance 0
      expect(result[0]).toEqual({ distance: 0, elevation: 10, grade: 0 })
      
      // Second point should have positive distance and grade
      expect(result[1].distance).toBeGreaterThan(0)
      expect(result[1].elevation).toBe(20)
      expect(result[1].grade).toBeGreaterThan(0) // Uphill
      
      // Third point should have even greater distance
      expect(result[2].distance).toBeGreaterThan(result[1].distance)
      expect(result[2].elevation).toBe(15)
      expect(result[2].grade).toBeLessThan(0) // Downhill
    })

    test('handles flat route correctly', () => {
      const geoPoints = [
        { latitude: 40.0, longitude: -74.0, elevation: 100 },
        { latitude: 40.1, longitude: -74.0, elevation: 100 },
        { latitude: 40.2, longitude: -74.0, elevation: 100 }
      ]
      
      const result = preprocessRouteData(geoPoints)
      
      expect(result[1].grade).toBe(0)
      expect(result[2].grade).toBe(0)
    })

    test('calculates cumulative distances correctly', () => {
      const geoPoints = [
        { latitude: 40.0, longitude: -74.0, elevation: 0 },
        { latitude: 40.1, longitude: -74.0, elevation: 0 },
        { latitude: 40.2, longitude: -74.0, elevation: 0 }
      ]
      
      const result = preprocessRouteData(geoPoints)
      
      // Distances should be cumulative and increasing
      expect(result[0].distance).toBe(0)
      expect(result[1].distance).toBeGreaterThan(0)
      expect(result[2].distance).toBeGreaterThan(result[1].distance)
    })
  })

  describe('getGradeForDistance', () => {
    let testRoute

    beforeEach(() => {
      // Create a test route with known points
      testRoute = [
        { distance: 0, elevation: 0, grade: 0 },
        { distance: 1000, elevation: 50, grade: 5 },    // 5% grade
        { distance: 2000, elevation: 50, grade: 0 },    // Flat
        { distance: 3000, elevation: 20, grade: -3 },   // -3% grade
        { distance: 4000, elevation: 20, grade: 0 }     // Flat to end
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

    test('returns exact grade at distance points', () => {
      expect(getGradeForDistance(0, testRoute)).toBe(0)      // At start
      expect(getGradeForDistance(1000, testRoute)).toBe(5)   // At 1km mark, should get 5% grade
      expect(getGradeForDistance(2000, testRoute)).toBe(0)   // At 2km mark, should get 0% grade
      expect(getGradeForDistance(3000, testRoute)).toBe(-3)  // At 3km mark, should get -3% grade
      expect(getGradeForDistance(4000, testRoute)).toBe(0)   // At 4km mark, should get 0% grade
    })

    test('returns correct grade between distance points', () => {
      // Between first and second point
      expect(getGradeForDistance(500, testRoute)).toBe(5)
      
      // Between second and third point  
      expect(getGradeForDistance(1500, testRoute)).toBe(0)
      
      // Between third and fourth point
      expect(getGradeForDistance(2500, testRoute)).toBe(-3)
    })

    test('handles distance exactly at route end', () => {
      expect(getGradeForDistance(4000, testRoute)).toBe(0)
    })
  })

  describe('Route Integration Tests', () => {
    test('preprocessed route works with getGradeForDistance', () => {
      // Create a realistic route with elevation changes
      const geoPoints = [
        { latitude: 37.7749, longitude: -122.4194, elevation: 0 },    // Sea level
        { latitude: 37.7849, longitude: -122.4094, elevation: 100 },  // Climb 100m
        { latitude: 37.7949, longitude: -122.3994, elevation: 150 },  // Climb 50m more
        { latitude: 37.8049, longitude: -122.3894, elevation: 50 },   // Descend 100m
        { latitude: 37.8149, longitude: -122.3794, elevation: 0 }     // Back to sea level
      ]

      const processedRoute = preprocessRouteData(geoPoints)
      
      // Test that we can get grades at various distances
      const startGrade = getGradeForDistance(0, processedRoute)
      const midGrade = getGradeForDistance(processedRoute[2].distance, processedRoute)
      const endGrade = getGradeForDistance(processedRoute[processedRoute.length - 1].distance, processedRoute)
      
      expect(startGrade).toBe(0) // First point always has grade 0
      expect(typeof midGrade).toBe('number')
      expect(typeof endGrade).toBe('number')
      
      // Should have some uphill and downhill sections
      const allGrades = processedRoute.map(p => p.grade)
      const hasUphill = allGrades.some(g => g > 0)
      const hasDownhill = allGrades.some(g => g < 0)
      
      expect(hasUphill).toBe(true)
      expect(hasDownhill).toBe(true)
    })

    test('realistic Leap Lane Hills data structure', () => {
      // Simulate the structure we saw in your actual data
      const leapLaneHills = {
        name: "Leap Lane Hills",
        distance: 8352.9,
        grade: 1.35,
        geoPoints: [
          { latitude: 51.1234, longitude: -0.5678, elevation: 100 },
          { latitude: 51.1244, longitude: -0.5688, elevation: 120 },
          { latitude: 51.1254, longitude: -0.5698, elevation: 140 },
          // ... more points would be here
          { latitude: 51.1354, longitude: -0.5798, elevation: 110 }
        ]
      }

      const processedRoute = preprocessRouteData(leapLaneHills.geoPoints)
      
      // Should process without errors
      expect(processedRoute.length).toBeGreaterThan(0)
      expect(processedRoute[0].distance).toBe(0)
      expect(processedRoute[0].grade).toBe(0)
      
      // Final distance should be reasonable for the segment
      const finalDistance = processedRoute[processedRoute.length - 1].distance
      expect(finalDistance).toBeGreaterThan(0)
      expect(finalDistance).toBeLessThan(50000) // Less than 50km seems reasonable
    })
  })
})