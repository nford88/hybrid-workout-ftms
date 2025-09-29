// Tests for workout state management and flow
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createTestEnvironment } from '../test-utils.js'
import { createMockTimer, setupTimerMocks } from '../mocks/timer-mock.js'

describe('Workout Flow Management', () => {
  let testEnv, mockTimer

  beforeEach(() => {
    testEnv = createTestEnvironment()
    mockTimer = createMockTimer()
    setupTimerMocks(mockTimer)
    testEnv.resetState()
  })

  // Extract workout functions for testing
  function recordStepSummary() {
    const S = global.Hybrid.state
    const W = S.workout
    const plan = S.workoutPlan

    if (W.currentStepIndex >= plan.length) return null

    const currentStep = plan[W.currentStepIndex]
    const stepEndTime = mockTimer.getCurrentTime()
    const stepDurationSec = (stepEndTime - W.stepStartTime) / 1000
    const stepDistanceMeters = currentStep.type === 'sim' ? 
      (W.stepSimDistance || 0) : 
      calculateErgStepDistance()
    
    const validatedDistance = Math.max(0, stepDistanceMeters)

    const summary = {
      stepNumber: W.currentStepIndex + 1,
      type: currentStep.type,
      plannedDuration: currentStep.duration ? currentStep.duration * 60 : null,
      actualDuration: stepDurationSec,
      distance: validatedDistance,
      averageSpeed: validatedDistance > 0 ? (validatedDistance / stepDurationSec) * 3.6 : 0,
      target: currentStep.type === 'erg' ? `${currentStep.power}W` : 'Route Grade',
      segmentName: currentStep.segmentName || null,
      routeDistance: currentStep.type === 'sim' ? (W.simDistanceTraveled || 0) : null,
      routeCompleted: currentStep.type === 'sim' ? (W.routeCompleted || false) : null
    }

    W.stepSummary.push(summary)
    return summary
  }

  function calculateErgStepDistance() {
    const stepDurationSec = (mockTimer.getCurrentTime() - global.Hybrid.state.workout.stepStartTime) / 1000
    const currentSpeedKph = parseFloat(testEnv.mockDOM.speedDisplay.textContent) || 0
    return (currentSpeedKph / 3.6) * stepDurationSec
  }

  function initializeWorkout() {
    const S = global.Hybrid.state
    const W = S.workout

    W.isRunning = true
    W.currentStepIndex = 0
    W.workoutStartTime = mockTimer.getCurrentTime()
    W.lastSimUpdateTs = 0
    W.simDistanceTraveled = 0
    W.stepSimDistance = 0
    W.stepSummary = []
    W.routeCompleted = false
  }

  function initializeStep(stepType, options = {}) {
    const W = global.Hybrid.state.workout
    W.stepStartTime = mockTimer.getCurrentTime()
    
    if (stepType === 'sim') {
      W.stepSimDistance = 0
      W.simDistanceTraveled = 0
      W.lastSimUpdateTs = 0
      W.routeCompleted = false
      W.currentGrade = 0
      W.targetGrade = 0
      W.lastGradeUpdate = mockTimer.getCurrentTime()
      W.lastGradeDistance = 0
      W.gradeHistory = []
    }
  }

  describe('Step Summary Recording', () => {
    test('records ERG step summary correctly', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 5, power: 200 }
      ]
      
      initializeWorkout()
      initializeStep('erg')
      
      // Simulate ERG step for 2 minutes at 30 kph
      testEnv.mockDOM.speedDisplay.textContent = '30'
      mockTimer.advanceTime(120000) // 2 minutes
      
      const summary = recordStepSummary()
      
      expect(summary.stepNumber).toBe(1)
      expect(summary.type).toBe('erg')
      expect(summary.plannedDuration).toBe(300) // 5 minutes in seconds
      expect(summary.actualDuration).toBe(120) // 2 minutes actual
      expect(summary.target).toBe('200W')
      expect(summary.routeDistance).toBeNull() // ERG steps don't have route distance
      expect(summary.routeCompleted).toBeNull()
      
      expect(summary.distance).toBeCloseTo(1000, 0) // 30kph for 2min = 1km
      expect(summary.averageSpeed).toBeCloseTo(30, 1)
    })

    test('records SIM step summary correctly', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' }
      ]
      
      global.Hybrid.state.garminRoute = {
        name: 'Test Route',
        totalDistance: 5000
      }
      
      initializeWorkout()
      initializeStep('sim')
      
      // Simulate SIM step
      global.Hybrid.state.workout.stepSimDistance = 6000 // Total distance
      global.Hybrid.state.workout.simDistanceTraveled = 5000 // Route distance (completed)
      global.Hybrid.state.workout.routeCompleted = true
      
      mockTimer.advanceTime(900000) // 15 minutes
      
      const summary = recordStepSummary()
      
      expect(summary.stepNumber).toBe(1)
      expect(summary.type).toBe('sim')
      expect(summary.plannedDuration).toBeNull() // SIM steps don't have planned duration
      expect(summary.actualDuration).toBe(900) // 15 minutes
      expect(summary.distance).toBe(6000) // Total step distance
      expect(summary.target).toBe('Route Grade')
      expect(summary.segmentName).toBe('Test Route')
      expect(summary.routeDistance).toBe(5000) // Route distance
      expect(summary.routeCompleted).toBe(true)
      
      expect(summary.averageSpeed).toBeCloseTo(24, 1) // 6km in 15min = 24kph
    })

    test('handles multiple step summaries', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 5, power: 150 },
        { type: 'sim', segmentName: 'Test Route' },
        { type: 'erg', duration: 3, power: 250 }
      ]
      
      initializeWorkout()
      
      // Step 1: ERG
      initializeStep('erg')
      testEnv.mockDOM.speedDisplay.textContent = '25'
      mockTimer.advanceTime(300000) // 5 minutes
      const summary1 = recordStepSummary()
      
      // Step 2: SIM
      global.Hybrid.state.workout.currentStepIndex = 1
      initializeStep('sim')
      global.Hybrid.state.workout.stepSimDistance = 4000
      global.Hybrid.state.workout.simDistanceTraveled = 3000
      mockTimer.advanceTime(600000) // 10 minutes
      const summary2 = recordStepSummary()
      
      // Step 3: ERG
      global.Hybrid.state.workout.currentStepIndex = 2
      initializeStep('erg')
      testEnv.mockDOM.speedDisplay.textContent = '28'
      mockTimer.advanceTime(180000) // 3 minutes
      const summary3 = recordStepSummary()
      
      expect(global.Hybrid.state.workout.stepSummary).toHaveLength(3)
      expect(summary1.stepNumber).toBe(1)
      expect(summary2.stepNumber).toBe(2)
      expect(summary3.stepNumber).toBe(3)
      
      expect(summary1.type).toBe('erg')
      expect(summary2.type).toBe('sim')
      expect(summary3.type).toBe('erg')
    })

    test('prevents negative distances', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' }
      ]
      
      initializeWorkout()
      initializeStep('sim')
      
      // Set negative distance (shouldn't happen but test safety)
      global.Hybrid.state.workout.stepSimDistance = -100
      mockTimer.advanceTime(60000)
      
      const summary = recordStepSummary()
      
      expect(summary.distance).toBe(0) // Should be corrected to 0
      expect(summary.averageSpeed).toBe(0)
    })
  })

  describe('Workout State Management', () => {
    test('initializes workout state correctly', () => {
      const stateBefore = { ...global.Hybrid.state.workout }
      
      initializeWorkout()
      
      expect(global.Hybrid.state.workout.isRunning).toBe(true)
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(0)
      expect(global.Hybrid.state.workout.workoutStartTime).toBeGreaterThan(0)
      expect(global.Hybrid.state.workout.stepSummary).toEqual([])
      expect(global.Hybrid.state.workout.routeCompleted).toBe(false)
    })

    test('step initialization resets SIM-specific state', () => {
      // Set some existing state
      global.Hybrid.state.workout.stepSimDistance = 1000
      global.Hybrid.state.workout.simDistanceTraveled = 800
      global.Hybrid.state.workout.routeCompleted = true
      global.Hybrid.state.workout.currentGrade = 5
      
      initializeStep('sim')
      
      expect(global.Hybrid.state.workout.stepSimDistance).toBe(0)
      expect(global.Hybrid.state.workout.simDistanceTraveled).toBe(0)
      expect(global.Hybrid.state.workout.routeCompleted).toBe(false)
      expect(global.Hybrid.state.workout.currentGrade).toBe(0)
    })

    test('step initialization does not affect ERG mode unnecessarily', () => {
      // SIM-specific state should not interfere with ERG
      global.Hybrid.state.workout.someErgState = 'preserved'
      
      initializeStep('erg')
      
      expect(global.Hybrid.state.workout.someErgState).toBe('preserved')
      expect(global.Hybrid.state.workout.stepStartTime).toBeGreaterThan(0)
    })
  })

  describe('Workout Timing', () => {
    test('tracks step duration accurately', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 1, power: 100 }
      ]
      
      initializeWorkout()
      initializeStep('erg')
      
      const startTime = mockTimer.getCurrentTime()
      mockTimer.advanceTime(45000) // 45 seconds
      
      const summary = recordStepSummary()
      
      expect(summary.actualDuration).toBe(45)
      expect(summary.plannedDuration).toBe(60) // 1 minute
    })

    test('handles multiple timing scenarios', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 2, power: 100 }
      ]
      
      initializeWorkout()
      
      // Short step
      initializeStep('erg')
      mockTimer.advanceTime(30000) // 30 seconds
      const shortSummary = recordStepSummary()
      
      // Long step (reset for new step)
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepSummary = []
      initializeStep('erg')
      mockTimer.advanceTime(180000) // 3 minutes
      const longSummary = recordStepSummary()
      
      expect(shortSummary.actualDuration).toBe(30)
      expect(longSummary.actualDuration).toBe(180)
    })
  })

  describe('Edge Cases', () => {
    test('handles empty workout plan', () => {
      global.Hybrid.state.workoutPlan = []
      global.Hybrid.state.workout.currentStepIndex = 0
      
      const summary = recordStepSummary()
      
      expect(summary).toBeNull()
      expect(global.Hybrid.state.workout.stepSummary).toEqual([])
    })

    test('handles step index beyond plan length', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 1, power: 100 }
      ]
      global.Hybrid.state.workout.currentStepIndex = 5 // Beyond plan
      
      const summary = recordStepSummary()
      
      expect(summary).toBeNull()
    })

    test('handles zero duration steps', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 1, power: 100 }
      ]
      
      initializeWorkout()
      initializeStep('erg')
      
      // Record immediately (0 duration)
      const summary = recordStepSummary()
      
      expect(summary.actualDuration).toBe(0)
      expect(summary.distance).toBe(0)
      expect(summary.averageSpeed).toBe(0)
    })
  })
})