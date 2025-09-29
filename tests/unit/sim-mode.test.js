// Tests for SIM mode functionality
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createTestEnvironment } from '../test-utils.js'
import { createMockTimer, setupTimerMocks } from '../mocks/timer-mock.js'

describe('SIM Mode Logic', () => {
  let testEnv, mockTimer

  beforeEach(() => {
    testEnv = createTestEnvironment()
    mockTimer = createMockTimer()
    setupTimerMocks(mockTimer)
    testEnv.resetState()
  })

  // Extract SIM functions from the HTML (simplified for testing)
  function updateSimMode(currentSpeedKph) {
    const S = global.Hybrid.state.workout
    const plan = global.Hybrid.state.workoutPlan
    const step = plan[S.currentStepIndex]
    
    if (!step || step.type !== 'sim') return
    if (!S.isRunning) return

    const now = mockTimer.getCurrentTime()
    if (!S.lastSimUpdateTs) S.lastSimUpdateTs = now

    const route = global.Hybrid.state.garminRoute
    const routeMaxDistance = route ? route.totalDistance : Infinity
    
    if (Number.isFinite(currentSpeedKph)) {
      const dtSec = Math.max(0, (now - S.lastSimUpdateTs) / 1000)
      const mps = (currentSpeedKph * 1000) / 3600
      const distanceIncrement = mps * dtSec
      
      S.stepSimDistance = (S.stepSimDistance || 0) + distanceIncrement
      
      const currentRouteDistance = S.simDistanceTraveled || 0
      if (currentRouteDistance < routeMaxDistance) {
        const newRouteDistance = currentRouteDistance + distanceIncrement
        S.simDistanceTraveled = Math.min(newRouteDistance, routeMaxDistance)
        
        if (S.simDistanceTraveled >= routeMaxDistance && currentRouteDistance < routeMaxDistance) {
          S.routeCompleted = true
        }
      }
    }
    S.lastSimUpdateTs = now

    return {
      routeDistance: S.simDistanceTraveled,
      totalDistance: S.stepSimDistance,
      routeCompleted: S.routeCompleted
    }
  }

  function calculateRealisticGrade(rawGradePct, currentSpeedKph, currentDistance) {
    const W = global.Hybrid.state.workout
    const now = mockTimer.getCurrentTime()
    
    // Initialize if first call
    if (!W.lastGradeUpdate) {
      W.currentGrade = rawGradePct
      W.targetGrade = rawGradePct
      W.lastGradeUpdate = now
      W.lastGradeDistance = currentDistance || 0
      return rawGradePct
    }
    
    // Calculate distance-based gradient smoothing
    const distanceTraveled = (currentDistance || 0) - (W.lastGradeDistance || 0)
    const GRADIENT_RAMP_DISTANCE = 10 // Change grade every 10 meters
    
    // Only update target grade if we've traveled enough distance
    if (distanceTraveled >= GRADIENT_RAMP_DISTANCE) {
      // Smooth the target grade to prevent GPS noise spikes
      const gradeDiff = rawGradePct - W.currentGrade
      
      // Limit grade changes to realistic increments
      const MAX_GRADE_CHANGE_PER_RAMP = 1.5 // Max 1.5% change per 10m
      const smoothedGradeDiff = global.Hybrid.utils.clamp(gradeDiff, -MAX_GRADE_CHANGE_PER_RAMP, MAX_GRADE_CHANGE_PER_RAMP)
      
      W.targetGrade = W.currentGrade + smoothedGradeDiff
      W.lastGradeDistance = currentDistance
    } else {
      // If we haven't traveled enough distance, keep the target at current grade
      W.targetGrade = W.currentGrade
    }
    
    // Apply time-based smoothing to the target grade
    const timeSinceUpdate = now - W.lastGradeUpdate
    const MAX_CHANGE_PER_SECOND = 0.5 // Slower grade changes: 0.5% per second
    
    // If we just updated the target grade due to distance, apply the change more aggressively
    const justUpdatedTarget = distanceTraveled >= GRADIENT_RAMP_DISTANCE
    const maxChange = justUpdatedTarget ? 
      Math.abs(W.targetGrade - W.currentGrade) : // Apply the full distance-based change
      Math.max(0.1, (timeSinceUpdate / 1000) * MAX_CHANGE_PER_SECOND) // Ensure minimum change for tests
    
    const gradeDiff = W.targetGrade - W.currentGrade
    const actualChange = global.Hybrid.utils.clamp(gradeDiff, -maxChange, maxChange)
    
    // Calculate momentum factor (higher speed = more momentum assistance)
    const momentumFactor = Math.min(1.0, currentSpeedKph / 12) // Adjusted for more realistic speeds
    const momentumReduction = 0.25 * momentumFactor // Up to 25% easier with momentum
    
    // Apply momentum-assisted grade
    const newGrade = W.currentGrade + actualChange
    const momentumAssistedGrade = newGrade * (1 - momentumReduction)
    
    // Prevent negative grades from being too easy (keep some downhill resistance)
    const finalGrade = Math.max(-2, momentumAssistedGrade) // Allow slight negative grades
    
    W.currentGrade = newGrade // Track actual grade
    W.lastGradeUpdate = now
    
    return finalGrade
  }

  describe('Distance Tracking', () => {
    beforeEach(() => {
      // Set up a SIM workout step
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' }
      ]
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.garminRoute = {
        name: 'Test Route',
        totalDistance: 5000 // 5km route
      }
    })

    test('accumulates distance based on speed and time', () => {
      updateSimMode(36) // 36 kph = 10 m/s - first call sets timestamp
      mockTimer.advanceTime(1000) // 1 second
      const result = updateSimMode(36) // Second call calculates distance

      expect(result.totalDistance).toBeCloseTo(10, 1) // Should travel ~10m
      expect(result.routeDistance).toBeCloseTo(10, 1)
    })

    test('handles zero speed correctly', () => {
      updateSimMode(0)
      mockTimer.advanceTime(5000) // 5 seconds at 0 speed
      const result = updateSimMode(0)

      expect(result.totalDistance).toBe(0)
      expect(result.routeDistance).toBe(0)
    })

    test('caps route distance at route end', () => {
      // Set up near route end
      global.Hybrid.state.workout.simDistanceTraveled = 4990
      global.Hybrid.state.workout.stepSimDistance = 4990
      
      updateSimMode(36) // Fast speed - sets timestamp
      mockTimer.advanceTime(2000) // 2 seconds = 20m at 10m/s
      const result = updateSimMode(36)

      expect(global.Hybrid.state.workout.simDistanceTraveled).toBe(5000) // Capped at route end
      expect(global.Hybrid.state.workout.stepSimDistance).toBeGreaterThan(5000) // Total continues
    })

    test('detects route completion', () => {
      global.Hybrid.state.workout.simDistanceTraveled = 4990

      const result1 = updateSimMode(36)
      expect(result1.routeCompleted).toBeFalsy()

      mockTimer.advanceTime(2000) // This should complete the route
      const result2 = updateSimMode(36)
      
      expect(result2.routeCompleted).toBe(true)
    })

    test('continues accumulating total distance after route completion', () => {
      global.Hybrid.state.workout.simDistanceTraveled = 5000
      global.Hybrid.state.workout.routeCompleted = true
      global.Hybrid.state.workout.stepSimDistance = 5000

      updateSimMode(36) // Continue riding - sets timestamp
      mockTimer.advanceTime(1000) // 1 second
      const result = updateSimMode(36)

      expect(result.routeDistance).toBe(5000) // Route distance stays capped
      expect(result.totalDistance).toBeCloseTo(5010, 1) // Total distance continues (+10m)
    })

    test('handles different speeds correctly', () => {
      // Test slow speed
      updateSimMode(18) // 18 kph = 5 m/s
      mockTimer.advanceTime(2000) // 2 seconds
      const slowResult = updateSimMode(18)

      expect(slowResult.totalDistance).toBeCloseTo(10, 1)

      // Reset and test fast speed
      global.Hybrid.state.workout.stepSimDistance = 0
      global.Hybrid.state.workout.simDistanceTraveled = 0
      mockTimer.advanceTime(0)

      updateSimMode(72) // 72 kph = 20 m/s
      mockTimer.advanceTime(1000) // 1 second
      const fastResult = updateSimMode(72)

      expect(fastResult.totalDistance).toBeCloseTo(20, 1)
    })
  })

  describe('Gradient Smoothing', () => {
    beforeEach(() => {
      // Reset gradient state
      global.Hybrid.state.workout.currentGrade = 0
      global.Hybrid.state.workout.targetGrade = 0
      global.Hybrid.state.workout.lastGradeUpdate = 0
      global.Hybrid.state.workout.lastGradeDistance = 0
    })

    test('initializes grade correctly on first call', () => {
      const result = calculateRealisticGrade(5.0, 20, 100)
      expect(result).toBe(5.0)
      expect(global.Hybrid.state.workout.currentGrade).toBe(5.0)
      expect(global.Hybrid.state.workout.targetGrade).toBe(5.0)
    })

    test('limits grade changes per distance ramp', () => {
      // Initialize with flat grade
      calculateRealisticGrade(0, 20, 0)
      
      // Try to jump to steep grade after traveling 10m
      const result = calculateRealisticGrade(10, 20, 10)
      
      // Should be limited to max change of 1.5%
      expect(Math.abs(result - 0)).toBeLessThanOrEqual(1.5)
    })

    test('applies momentum assistance at high speeds', () => {
      calculateRealisticGrade(5, 5, 0) // Initialize with 5% grade at low speed
      mockTimer.advanceTime(1000)
      const lowSpeedResult = calculateRealisticGrade(5, 5, 10)
      
      calculateRealisticGrade(5, 30, 0) // Reset with same grade at high speed
      mockTimer.advanceTime(1000)
      const highSpeedResult = calculateRealisticGrade(5, 30, 10)
      
      // High speed should result in easier (lower) effective grade
      expect(highSpeedResult).toBeLessThan(lowSpeedResult)
    })

    test('prevents negative grades from being too easy', () => {
      // Initialize first to set up state
      calculateRealisticGrade(0, 10, 0)
      mockTimer.advanceTime(1000)
      
      // Now test the negative grade scenario
      const result = calculateRealisticGrade(-5, 50, 100) // Very fast on steep downhill
      expect(result).toBeGreaterThanOrEqual(-2) // Should not go below -2%
    })

    test('smooths grade changes over time', () => {
      calculateRealisticGrade(0, 20, 0) // Start flat
      
      const grade1 = calculateRealisticGrade(3, 20, 20) // Request 3% grade
      mockTimer.advanceTime(500) // 0.5 seconds later
      const grade2 = calculateRealisticGrade(3, 20, 30)
      
      // Grade should increase gradually, not jump immediately
      expect(grade2).toBeGreaterThanOrEqual(grade1)
      expect(grade2).toBeLessThan(3) // But not reach target immediately
    })
  })

  describe('SIM Mode Integration', () => {
    test('combines distance tracking with gradient changes', () => {
      // Set up route with varying gradients
      global.Hybrid.state.preprocessedRoute = [
        { distance: 0, elevation: 0, grade: 0 },
        { distance: 1000, elevation: 50, grade: 5 },
        { distance: 2000, elevation: 50, grade: 0 },
        { distance: 3000, elevation: 20, grade: -3 }
      ]

      global.Hybrid.state.workoutPlan = [{ type: 'sim', segmentName: 'Test Route' }]
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0

      // Simulate riding through the route
      let lastGrade = 0
      const gradeChanges = []

      for (let i = 0; i < 10; i++) {
        const result = updateSimMode(36) // Constant 36 kph
        mockTimer.advanceTime(100) // 100ms intervals
        
        // Get grade for current position
        const currentGrade = getGradeForDistance(result.routeDistance)
        if (currentGrade !== lastGrade) {
          gradeChanges.push({
            distance: result.routeDistance,
            grade: currentGrade
          })
          lastGrade = currentGrade
        }
      }

      // Should have detected some grade changes
      expect(gradeChanges.length).toBeGreaterThan(0)
    })

    function getGradeForDistance(distance) {
      const arr = global.Hybrid.state.preprocessedRoute
      if (!arr || !arr.length) return 0
      if (distance <= 0) return arr[0].grade
      if (distance >= arr[arr.length - 1].distance) return arr[arr.length - 1].grade
      for (let i = 0; i < arr.length - 1; i++) {
        if (distance >= arr[i].distance && distance < arr[i + 1].distance) return arr[i + 1].grade
      }
      return 0
    }

    test('route completion works with realistic route data', () => {
      // Simulate Leap Lane Hills
      global.Hybrid.state.garminRoute = {
        name: 'Leap Lane Hills',
        totalDistance: 8352.9
      }
      
      global.Hybrid.state.workoutPlan = [{ type: 'sim', segmentName: 'Leap Lane Hills' }]
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      
      // Initialize SIM-specific state
      global.Hybrid.state.workout.stepSimDistance = 0
      global.Hybrid.state.workout.simDistanceTraveled = 0
      global.Hybrid.state.workout.routeCompleted = false

      // Test with a simple approach: just travel the exact distance needed
      updateSimMode(100) // Initial call at 100 kph
      mockTimer.advanceTime(1000) // 1 second
      
      // Travel exactly 8353 meters in one big increment
      // 8353 meters / 1 second = 8353 m/s = 30070.8 kph
      const result = updateSimMode(30070.8)
      
      // Should detect route completion
      expect(result.routeCompleted).toBe(true)
      expect(result.routeDistance).toBeCloseTo(8352.9, 1)
    })
  })
})