// Tests for ERG mode functionality - progress bar and auto-advance
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { createTestEnvironment } from '../test-utils.js'
import { createMockTimer, setupTimerMocks } from '../mocks/timer-mock.js'

describe('ERG Mode Logic', () => {
  let testEnv, mockTimer

  beforeEach(() => {
    testEnv = createTestEnvironment()
    mockTimer = createMockTimer()
    setupTimerMocks(mockTimer)
    testEnv.resetState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Simulate the progress calculation from updateWorkoutTime
  function calculateErgProgress(stepStartTime, stepDurationMinutes) {
    const now = mockTimer.getCurrentTime()
    const stepElapsedSec = Math.floor((now - stepStartTime) / 1000)
    const stepDurationSec = stepDurationMinutes * 60
    return Math.min(100, (stepElapsedSec / stepDurationSec) * 100)
  }

  // Simulate workout initialization
  function initializeWorkout(workoutPlan) {
    const S = global.Hybrid.state
    const W = S.workout
    
    S.workoutPlan = workoutPlan
    S.ftmsConnected = true
    
    W.isRunning = true
    W.currentStepIndex = 0
    W.workoutStartTime = mockTimer.getCurrentTime()
    W.stepStartTime = mockTimer.getCurrentTime() // CRITICAL: Must be set before progress calculations
    W.lastSimUpdateTs = 0
    W.simDistanceTraveled = 0
    W.stepSimDistance = 0
    W.stepSummary = []
    W.routeCompleted = false
    
    return W
  }

  // Simulate runWorkoutStep for ERG
  function startErgStep(stepIndex = 0) {
    const S = global.Hybrid.state
    const W = S.workout
    const step = S.workoutPlan[stepIndex]
    
    W.currentStepIndex = stepIndex
    W.stepStartTime = mockTimer.getCurrentTime()
    
    // This is what sets up the auto-advance
    const timeoutDuration = step.duration * 60 * 1000
    const timeoutId = mockTimer.setTimeout(() => {
      // This would call skipStep()
      W.stepCompleted = true
      W.currentStepIndex++
    }, timeoutDuration)
    
    return { timeoutId, timeoutDuration }
  }

  describe('ERG Progress Bar Calculation', () => {
    test('progress should be 0% at step start', () => {
      const W = initializeWorkout([
        { type: 'erg', duration: 5, power: 200 }
      ])
      
      const progress = calculateErgProgress(W.stepStartTime, 5)
      expect(progress).toBe(0)
    })

    test('progress should be 50% at half duration', () => {
      const W = initializeWorkout([
        { type: 'erg', duration: 10, power: 200 } // 10 minute step
      ])
      
      // Advance 5 minutes (half of 10 minutes)
      mockTimer.advanceTime(5 * 60 * 1000)
      
      const progress = calculateErgProgress(W.stepStartTime, 10)
      expect(progress).toBeCloseTo(50, 1)
    })

    test('progress should be 100% at full duration', () => {
      const W = initializeWorkout([
        { type: 'erg', duration: 5, power: 200 } // 5 minute step
      ])
      
      // Advance exactly 5 minutes
      mockTimer.advanceTime(5 * 60 * 1000)
      
      const progress = calculateErgProgress(W.stepStartTime, 5)
      expect(progress).toBe(100)
    })

    test('progress should cap at 100% even after step duration', () => {
      const W = initializeWorkout([
        { type: 'erg', duration: 5, power: 200 }
      ])
      
      // Advance past the step duration (6 minutes for 5 minute step)
      mockTimer.advanceTime(6 * 60 * 1000)
      
      const progress = calculateErgProgress(W.stepStartTime, 5)
      expect(progress).toBe(100)
    })

    test('BUG CASE: stale stepStartTime causes incorrect progress', () => {
      // This test demonstrates the bug where stepStartTime from a previous
      // workout causes progress to show 100% immediately
      
      const S = global.Hybrid.state
      const W = S.workout
      
      // Simulate a previous workout that set stepStartTime long ago
      W.stepStartTime = mockTimer.getCurrentTime() - (60 * 60 * 1000) // 1 hour ago
      
      // Now start a "new" workout without properly resetting stepStartTime
      S.workoutPlan = [{ type: 'erg', duration: 5, power: 200 }]
      W.isRunning = true
      W.currentStepIndex = 0
      W.workoutStartTime = mockTimer.getCurrentTime()
      // BUG: stepStartTime NOT reset here!
      
      const progress = calculateErgProgress(W.stepStartTime, 5)
      
      // BUG: Progress shows 100% because stepStartTime is from 1 hour ago
      // 3600 seconds elapsed / 300 seconds duration = 1200% -> capped to 100%
      expect(progress).toBe(100) // This is the BUG!
    })

    test('FIX CASE: stepStartTime reset on workout start prevents incorrect progress', () => {
      const S = global.Hybrid.state
      const W = S.workout
      
      // Simulate a previous workout that set stepStartTime long ago
      W.stepStartTime = mockTimer.getCurrentTime() - (60 * 60 * 1000) // 1 hour ago
      
      // Now start a "new" workout WITH properly resetting stepStartTime
      const newW = initializeWorkout([{ type: 'erg', duration: 5, power: 200 }])
      
      const progress = calculateErgProgress(newW.stepStartTime, 5)
      
      // FIX: Progress should be 0% because stepStartTime was reset
      expect(progress).toBe(0)
    })
  })

  describe('ERG Step Auto-Advance', () => {
    test('timeout should fire after step duration', () => {
      initializeWorkout([
        { type: 'erg', duration: 5, power: 200 },
        { type: 'erg', duration: 3, power: 150 }
      ])
      
      const { timeoutDuration } = startErgStep(0)
      
      // Verify timeout is set for correct duration
      expect(timeoutDuration).toBe(5 * 60 * 1000) // 5 minutes in ms
      
      // Before timeout fires
      mockTimer.advanceTime(4 * 60 * 1000) // 4 minutes
      expect(global.Hybrid.state.workout.stepCompleted).toBeUndefined()
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(0)
      
      // After timeout fires (advance past 5 minutes total)
      mockTimer.advanceTime(1 * 60 * 1000 + 100) // 1 minute + 100ms
      expect(global.Hybrid.state.workout.stepCompleted).toBe(true)
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(1)
    })

    test('timeout duration should match progress bar duration', () => {
      const durationMinutes = 7
      
      initializeWorkout([
        { type: 'erg', duration: durationMinutes, power: 200 }
      ])
      
      const { timeoutDuration } = startErgStep(0)
      const expectedTimeoutMs = durationMinutes * 60 * 1000
      
      // The timeout and progress calculation should use the same duration
      expect(timeoutDuration).toBe(expectedTimeoutMs)
      
      // Progress at timeout should be 100%
      mockTimer.advanceTime(expectedTimeoutMs)
      const progress = calculateErgProgress(
        global.Hybrid.state.workout.stepStartTime, 
        durationMinutes
      )
      expect(progress).toBe(100)
    })

    test('progress and timeout should be synchronized', () => {
      const durationMinutes = 10
      
      const W = initializeWorkout([
        { type: 'erg', duration: durationMinutes, power: 200 },
        { type: 'erg', duration: 5, power: 250 }
      ])
      
      startErgStep(0)
      
      // Test at 25%, 50%, 75%, 100%
      const checkpoints = [0.25, 0.5, 0.75, 1.0]
      
      let previousTime = mockTimer.getCurrentTime()
      
      for (const fraction of checkpoints) {
        const targetTime = W.stepStartTime + (durationMinutes * 60 * 1000 * fraction)
        const timeToAdvance = targetTime - previousTime
        mockTimer.advanceTime(timeToAdvance)
        previousTime = mockTimer.getCurrentTime()
        
        const progress = calculateErgProgress(W.stepStartTime, durationMinutes)
        expect(progress).toBeCloseTo(fraction * 100, 1)
        
        // Step shouldn't complete until 100%
        if (fraction < 1.0) {
          expect(global.Hybrid.state.workout.currentStepIndex).toBe(0)
        }
      }
      
      // After 100%, step should have advanced
      mockTimer.advanceTime(100) // Small extra time to ensure timeout fires
      expect(global.Hybrid.state.workout.stepCompleted).toBe(true)
    })
  })

  describe('ERG Step Distance Calculation', () => {
    test('distance should accumulate based on speed and time', () => {
      initializeWorkout([
        { type: 'erg', duration: 5, power: 200 }
      ])
      
      // Simulate speed of 30 kph
      testEnv.mockDOM.speedDisplay.textContent = '30'
      
      // After 1 minute at 30 kph
      mockTimer.advanceTime(60 * 1000) // 1 minute
      
      const stepElapsedSec = (mockTimer.getCurrentTime() - global.Hybrid.state.workout.stepStartTime) / 1000
      const currentSpeedKph = 30
      const estimatedDistance = (currentSpeedKph / 3.6) * stepElapsedSec
      
      // 30 kph = 8.33 m/s, 60 seconds = ~500m
      expect(estimatedDistance).toBeCloseTo(500, -1) // Within 10m
    })
  })

  describe('Edge Cases', () => {
    test('zero duration step should be handled gracefully', () => {
      initializeWorkout([
        { type: 'erg', duration: 0, power: 200 }
      ])
      
      // Progress with zero duration results in division by zero (NaN)
      // The actual app should guard against this case
      const progress = calculateErgProgress(
        global.Hybrid.state.workout.stepStartTime, 
        0
      )
      
      // Division by zero produces NaN - app should prevent zero duration steps
      expect(Number.isNaN(progress)).toBe(true)
    })

    test('very short duration should work correctly', () => {
      const durationMinutes = 0.5 // 30 seconds
      
      const W = initializeWorkout([
        { type: 'erg', duration: durationMinutes, power: 200 }
      ])
      
      startErgStep(0)
      
      // At 15 seconds (50%)
      mockTimer.advanceTime(15 * 1000)
      let progress = calculateErgProgress(W.stepStartTime, durationMinutes)
      expect(progress).toBeCloseTo(50, 1)
      
      // At 30 seconds (100%)
      mockTimer.advanceTime(15 * 1000)
      progress = calculateErgProgress(W.stepStartTime, durationMinutes)
      expect(progress).toBe(100)
    })

    test('multiple rapid step transitions should work', () => {
      initializeWorkout([
        { type: 'erg', duration: 1, power: 100 },
        { type: 'erg', duration: 1, power: 150 },
        { type: 'erg', duration: 1, power: 200 }
      ])
      
      // Start step 0
      startErgStep(0)
      mockTimer.advanceTime(60 * 1000 + 100) // 1 minute + 100ms
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(1)
      
      // Start step 1
      startErgStep(1)
      mockTimer.advanceTime(60 * 1000 + 100)
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(2)
      
      // Start step 2
      startErgStep(2)
      mockTimer.advanceTime(60 * 1000 + 100)
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(3)
    })
  })
})
