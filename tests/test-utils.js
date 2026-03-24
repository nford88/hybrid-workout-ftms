// Extract and expose functions from the HTML file for testing
// This simulates the browser environment by creating the global Hybrid object

import { createMockDOM } from './mocks/dom-mock.js'
import { createMockFTMS } from './mocks/ftms-mock.js'
import { haversineDistance } from '../src/utils/geo'
import { clamp } from '../src/utils/math'
import { formatTime } from '../src/utils/time'

// Create a minimal environment to run the functions
export function createTestEnvironment() {
  const mockDOM = createMockDOM()
  const mockFTMS = createMockFTMS()

  // Create global Hybrid object structure
  global.Hybrid = {
    dom: mockDOM,
    state: {
      garminRoute: null,
      preprocessedRoute: [],
      workoutPlan: [],
      ftmsConnected: false,
      workout: {
        isRunning: false,
        currentStepIndex: 0,
        stepStartTime: 0,
        workoutStartTime: 0,
        totalWorkoutDuration: 0,
        simDistanceTraveled: 0,
        lastSimUpdateTs: 0,
        stepSummary: [],
        stepSimDistance: 0,
        summary: null,
        currentGrade: 0,
        targetGrade: 0,
        lastGradeUpdate: 0,
        lastGradeDistance: 0,
        gradeHistory: [],
        routeCompleted: false,
      },
    },
    timers: { ergTimeout: null, simInterval: null, totalWorkoutTimeInterval: null },
    utils: {
      clamp,
      haversineDistance,
      formatTime,
      showError: (m) => {
        mockDOM.errorText.textContent = m
        mockDOM.errorDiv.classList.remove('hidden')
      },
      hideError: () => mockDOM.errorDiv.classList.add('hidden'),
    },
    route: {},
    erg: {},
    sim: {},
    handlers: {},
    ui: {},
    workout: {},
  }

  // Mock the global ftms object
  global.ftms = mockFTMS
  global.window = global.window || {}
  global.window.ftms = mockFTMS

  return {
    Hybrid: global.Hybrid,
    mockDOM,
    mockFTMS,
    resetState: () => {
      global.Hybrid.state.garminRoute = null
      global.Hybrid.state.preprocessedRoute = []
      global.Hybrid.state.workoutPlan = []
      global.Hybrid.state.ftmsConnected = false
      global.Hybrid.state.workout = {
        isRunning: false,
        currentStepIndex: 0,
        stepStartTime: 0,
        workoutStartTime: 0,
        totalWorkoutDuration: 0,
        simDistanceTraveled: 0,
        lastSimUpdateTs: 0,
        stepSummary: [],
        stepSimDistance: 0,
        summary: null,
        currentGrade: 0,
        targetGrade: 0,
        lastGradeUpdate: 0,
        lastGradeDistance: 0,
        gradeHistory: [],
        routeCompleted: false,
      }
      mockFTMS.clearCallLog()
    },
  }
}
