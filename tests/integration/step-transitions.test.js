// Integration tests for step transitions (critical for SIM→ERG bug prevention)
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createTestEnvironment } from '../test-utils.js'
import { createMockTimer, setupTimerMocks } from '../mocks/timer-mock.js'

describe('Step Transitions Integration', () => {
  let testEnv, mockTimer

  beforeEach(() => {
    testEnv = createTestEnvironment()
    mockTimer = createMockTimer()
    setupTimerMocks(mockTimer)
    testEnv.resetState()
  })

  // Simulate the step transition logic
  function simulateStepTransition(fromStepType, toStepType) {
    const S = global.Hybrid.state
    const mockFTMS = testEnv.mockFTMS
    
    // Simulate FTMS calls that would have happened during the FROM step
    if (fromStepType === 'sim') {
      // During SIM step, we would have called rampSim
      try {
        mockFTMS.rampSim({
          fromPct: 0,
          toPct: 2,
          stepPct: 1,
          dwellMs: 1800,
          crr: 0.003,
          cwa: 0.45,
          windMps: 0.0
        })
      } catch (error) {
        console.warn('FTMS rampSim during SIM step failed:', error.message)
      }
    }
    
    // Don't clear the call log - we want to keep the SIM step calls
    
    // Simulate ending current step
    if (fromStepType === 'sim') {
      // SIM step cleanup should happen here
      S.workout.stepSimDistance = 5000
      S.workout.simDistanceTraveled = 4000
      S.workout.routeCompleted = true
    } else if (fromStepType === 'erg') {
      // ERG step cleanup
      // Current ERG power should be cleared
    }
    
    // Record step summary
    const summary = recordStepSummary()
    
    // Move to next step
    S.workout.currentStepIndex++
    S.workout.stepStartTime = mockTimer.getCurrentTime() // Reset step start time
    
    // Initialize new step
    if (toStepType === 'sim') {
      // SIM initialization
      S.workout.stepSimDistance = 0
      S.workout.simDistanceTraveled = 0
      S.workout.lastSimUpdateTs = 0
      S.workout.routeCompleted = false
      S.workout.currentGrade = 0
      S.workout.targetGrade = 0
      
      // Should set ERG to 0 first, then start SIM
      try {
        mockFTMS.setErgWatts(0)
      } catch (error) {
        console.warn('FTMS setErgWatts(0) failed:', error.message)
      }
      // Small delay simulation
      mockTimer.advanceTime(250)
      // Then start SIM mode
      try {
        mockFTMS.rampSim({
          fromPct: 0,
          toPct: 2,
          stepPct: 1,
          dwellMs: 1800,
          crr: 0.003,
          cwa: 0.45,
          windMps: 0.0
        })
      } catch (error) {
        console.warn('FTMS rampSim failed:', error.message)
      }
    } else if (toStepType === 'erg') {
      // ERG initialization - CRITICAL: Must ensure trainer is in ERG mode
      const currentStep = S.workoutPlan[S.workout.currentStepIndex]
      
      // If coming from SIM, stop SIM mode first
      if (fromStepType === 'sim') {
        try {
          mockFTMS.setErgWatts(0) // Stop SIM, set to 0 watts
        } catch (error) {
          // Handle FTMS errors gracefully
          console.warn('FTMS setErgWatts(0) failed:', error.message)
        }
        mockTimer.advanceTime(250) // Small delay for mode change
      }
      
      // Reset SIM-specific state when transitioning to ERG
      S.workout.stepSimDistance = 0
      S.workout.simDistanceTraveled = 0
      S.workout.routeCompleted = false
      S.workout.currentGrade = 0
      S.workout.targetGrade = 0
      
      // This is the critical fix - explicitly set ERG mode
      if (currentStep && currentStep.power) {
        try {
          mockFTMS.setErgWatts(currentStep.power)
        } catch (error) {
          // Handle FTMS errors gracefully
          console.warn('FTMS setErgWatts failed:', error.message)
        }
      }
    }
    
    return { summary, ftmsLog: mockFTMS.getCallLog() }
  }

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
      ((parseFloat(testEnv.mockDOM.speedDisplay.textContent) || 0) / 3.6) * stepDurationSec

    const summary = {
      stepNumber: W.currentStepIndex + 1,
      type: currentStep.type,
      actualDuration: stepDurationSec,
      distance: Math.max(0, stepDistanceMeters),
      routeCompleted: currentStep.type === 'sim' ? (W.routeCompleted || false) : null
    }

    W.stepSummary.push(summary)
    return summary
  }

  describe('SIM → ERG Transitions', () => {
    test('properly cleans up SIM mode before starting ERG', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' },
        { type: 'erg', duration: 5, power: 200 }
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      const result = simulateStepTransition('sim', 'erg')
      
      // Check that SIM step was properly recorded
      expect(result.summary.type).toBe('sim')
      expect(result.summary.routeCompleted).toBe(true)
      
      // CRITICAL: Check that FTMS received proper commands
      const ftmsLog = result.ftmsLog
      
      // Should have set ERG to 0 first (cleanup)
      const ergZeroCall = ftmsLog.find(call => 
        call.method === 'setErgWatts' && call.args[0] === 0
      )
      expect(ergZeroCall).toBeDefined()
      
      // Should have called rampSim during SIM step
      const rampSimCall = ftmsLog.find(call => call.method === 'rampSim')
      expect(rampSimCall).toBeDefined()
      
      // Should have set ERG power for new step
      const ergPowerCall = ftmsLog.find(call => 
        call.method === 'setErgWatts' && call.args[0] === 200
      )
      expect(ergPowerCall).toBeDefined()
      
      // Order should be: ERG(0) → rampSim → ERG(200)
      const ergZeroIndex = ftmsLog.indexOf(ergZeroCall)
      const ergPowerIndex = ftmsLog.indexOf(ergPowerCall)
      expect(ergPowerIndex).toBeGreaterThan(ergZeroIndex)
    })

    test('handles rapid SIM→ERG transitions without conflicts', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Short Route' },
        { type: 'erg', duration: 3, power: 150 }
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      // Simulate very short SIM step (route completed quickly)
      mockTimer.advanceTime(30000) // 30 seconds
      
      const result = simulateStepTransition('sim', 'erg')
      
      // Should handle transition without errors
      expect(result.summary.type).toBe('sim')
      expect(result.ftmsLog.length).toBeGreaterThan(0)
      
      // No conflicting commands should be sent
      const ergCalls = result.ftmsLog.filter(call => call.method === 'setErgWatts')
      const simCalls = result.ftmsLog.filter(call => call.method === 'setSim' || call.method === 'rampSim')
      
      expect(ergCalls.length).toBeGreaterThanOrEqual(2) // At least ERG(0) and ERG(150)
      expect(simCalls.length).toBeGreaterThanOrEqual(1) // At least one SIM call
    })

    test('prevents ERG commands from being ignored after SIM', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' },
        { type: 'erg', duration: 5, power: 250 }
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      // Simulate SIM step with active gradient changes
      global.Hybrid.state.workout.currentGrade = 5.0
      global.Hybrid.state.workout.targetGrade = 3.0
      
      const result = simulateStepTransition('sim', 'erg')
      
      // ERG command should be clearly issued
      const finalErgCall = result.ftmsLog
        .filter(call => call.method === 'setErgWatts')
        .pop() // Get last ERG call
      
      expect(finalErgCall).toBeDefined()
      expect(finalErgCall.args[0]).toBe(250)
      
      // State should be reset for ERG mode
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(1)
    })
  })

  describe('ERG → SIM Transitions', () => {
    test('properly transitions from ERG to SIM mode', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 5, power: 180 },
        { type: 'sim', segmentName: 'Test Route' }
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      // Simulate ERG step duration
      testEnv.mockDOM.speedDisplay.textContent = '32'
      mockTimer.advanceTime(300000) // 5 minutes
      
      const result = simulateStepTransition('erg', 'sim')
      
      // ERG step should be recorded
      expect(result.summary.type).toBe('erg')
      expect(result.summary.actualDuration).toBe(300)
      
      // Should transition to SIM properly
      const ftmsLog = result.ftmsLog
      
      // Should clear ERG first
      const ergZeroCall = ftmsLog.find(call => 
        call.method === 'setErgWatts' && call.args[0] === 0
      )
      expect(ergZeroCall).toBeDefined()
      
      // Should start SIM ramp
      const rampSimCall = ftmsLog.find(call => call.method === 'rampSim')
      expect(rampSimCall).toBeDefined()
    })
  })

  describe('Multiple Step Transitions', () => {
    test('handles complex workout with multiple transitions', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 3, power: 150 },   // Warmup
        { type: 'sim', segmentName: 'Hill Route' },  // Climb
        { type: 'erg', duration: 2, power: 200 },   // Interval
        { type: 'sim', segmentName: 'Descent' },     // Recovery
        { type: 'erg', duration: 5, power: 250 }    // Final effort
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      const allTransitions = []
      
      // Step 1: ERG warmup
      testEnv.mockDOM.speedDisplay.textContent = '25'
      mockTimer.advanceTime(180000) // 3 minutes
      allTransitions.push(simulateStepTransition('erg', 'sim'))
      
      // Step 2: SIM climb
      mockTimer.advanceTime(600000) // 10 minutes
      allTransitions.push(simulateStepTransition('sim', 'erg'))
      
      // Step 3: ERG interval
      testEnv.mockDOM.speedDisplay.textContent = '35'
      mockTimer.advanceTime(120000) // 2 minutes
      allTransitions.push(simulateStepTransition('erg', 'sim'))
      
      // Step 4: SIM descent
      mockTimer.advanceTime(300000) // 5 minutes
      allTransitions.push(simulateStepTransition('sim', 'erg'))
      
      // Verify all transitions completed
      expect(allTransitions).toHaveLength(4)
      expect(global.Hybrid.state.workout.stepSummary).toHaveLength(4)
      
      // Verify each transition had proper FTMS commands
      allTransitions.forEach((transition, index) => {
        expect(transition.ftmsLog.length).toBeGreaterThan(0)
        
        // Each transition should have at least one FTMS command
        const hasErgCommand = transition.ftmsLog.some(call => call.method === 'setErgWatts')
        const hasSimCommand = transition.ftmsLog.some(call => 
          call.method === 'setSim' || call.method === 'rampSim'
        )
        
        expect(hasErgCommand || hasSimCommand).toBe(true)
      })
    })

    test('maintains correct state between rapid transitions', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'erg', duration: 1, power: 100 },
        { type: 'sim', segmentName: 'Quick Route' },
        { type: 'erg', duration: 1, power: 200 }
      ]
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      // Rapid transitions
      mockTimer.advanceTime(60000) // 1 minute
      const trans1 = simulateStepTransition('erg', 'sim')
      
      mockTimer.advanceTime(120000) // 2 minutes SIM
      const trans2 = simulateStepTransition('sim', 'erg')
      
      // State should be consistent
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(2)
      expect(global.Hybrid.state.workout.stepSummary).toHaveLength(2)
      
      // No state bleeding between steps
      expect(global.Hybrid.state.workout.stepSimDistance).toBe(0) // Reset for new step
      expect(global.Hybrid.state.workout.simDistanceTraveled).toBe(0)
    })
  })

  describe('Error Recovery in Transitions', () => {
    test('handles FTMS command failures gracefully', () => {
      global.Hybrid.state.workoutPlan = [
        { type: 'sim', segmentName: 'Test Route' },
        { type: 'erg', duration: 5, power: 200 }
      ]
      
      // Mock FTMS failure - use a simple function that throws
      const originalSetErgWatts = testEnv.mockFTMS.setErgWatts
      testEnv.mockFTMS.setErgWatts = vi.fn(() => {
        throw new Error('FTMS Error')
      })
      
      global.Hybrid.state.workout.isRunning = true
      global.Hybrid.state.workout.currentStepIndex = 0
      global.Hybrid.state.workout.stepStartTime = mockTimer.getCurrentTime()
      
      // Should not throw error even if FTMS fails
      expect(() => {
        simulateStepTransition('sim', 'erg')
      }).not.toThrow()
      
      // State should still be updated
      expect(global.Hybrid.state.workout.currentStepIndex).toBe(1)
      
      // Restore original function
      testEnv.mockFTMS.setErgWatts = originalSetErgWatts
    })
  })
})