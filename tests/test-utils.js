// Extract and expose functions from the HTML file for testing
// This simulates the browser environment by creating the global Hybrid object

import { createMockDOM } from './mocks/dom-mock.js'
import { createMockFTMS } from './mocks/ftms-mock.js'

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
        routeCompleted: false
      }
    },
    timers: { ergTimeout: null, simInterval: null, totalWorkoutTimeInterval: null },
    utils: {
      clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      R: 6371e3,
      haversineDistance: (lat1, lon1, lat2, lon2) => {
        const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return global.Hybrid.utils.R * c;
      },
      showError: (m) => { mockDOM.errorText.textContent = m; mockDOM.errorDiv.classList.remove('hidden'); },
      hideError: () => mockDOM.errorDiv.classList.add('hidden'),
      formatTime: (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    },
    route: {},
    erg: {},
    sim: {},
    handlers: {},
    ui: {},
    workout: {}
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
        routeCompleted: false
      }
      mockFTMS.clearCallLog()
    }
  }
}