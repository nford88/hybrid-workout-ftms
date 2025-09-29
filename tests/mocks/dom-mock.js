// Mock DOM elements for testing
import { vi } from 'vitest'

export function createMockDOM() {
  return {
    // Mock common DOM elements used in the app
    garminDataTextarea: { value: '', textContent: '' },
    saveRouteButton: { addEventListener: vi.fn(), disabled: false },
    routeInputContainer: { classList: { add: vi.fn(), remove: vi.fn() } },
    routeInfoDiv: { classList: { add: vi.fn(), remove: vi.fn() } },
    segmentNameSpan: { textContent: '' },
    totalDistanceSpan: { textContent: '' },
    averageGradeSpan: { textContent: '' },
    errorDiv: { classList: { add: vi.fn(), remove: vi.fn() } },
    errorText: { textContent: '' },

    stepTypeSelect: { 
      value: 'erg',
      addEventListener: vi.fn(),
      querySelector: vi.fn().mockReturnValue({ disabled: false })
    },
    ergInputsDiv: { classList: { add: vi.fn(), remove: vi.fn() } },
    simInputsDiv: { classList: { add: vi.fn(), remove: vi.fn() } },
    ergDurationInput: { value: '' },
    ergPowerInput: { value: '' },
    addStepButton: { addEventListener: vi.fn() },
    workoutListDiv: { innerHTML: '', appendChild: vi.fn(), querySelectorAll: vi.fn().mockReturnValue([]) },
    clearWorkoutButton: { classList: { add: vi.fn(), remove: vi.fn() } },
    noStepsMessage: { classList: { add: vi.fn(), remove: vi.fn() } },

    connectButton: { 
      addEventListener: vi.fn(),
      disabled: false,
      textContent: 'Connect Trainer',
      className: ''
    },
    startWorkoutButton: { addEventListener: vi.fn() },
    skipStepButton: { addEventListener: vi.fn() },
    connectionStatus: { textContent: 'Status: Disconnected', className: '' },

    powerDisplay: { textContent: '0' },
    speedDisplay: { textContent: '0.0' },
    cadenceDisplay: { textContent: '0' },
    timeDisplay: { textContent: '00:00' },
    gradientDisplay: { textContent: '—', className: '' },
    stepDistanceDisplay: { textContent: '—' },

    workoutProgressText: { textContent: 'Ready to ride!' },
    progressBar: { style: { width: '0%' } },
    targetDisplay: { textContent: '' },
    simSegmentSelect: { innerHTML: '' }
  }
}

// Mock document for creating elements
export function mockDocument() {
  return {
    getElementById: vi.fn((id) => {
      const mockDOM = createMockDOM()
      return mockDOM[id] || null
    }),
    createElement: vi.fn((tag) => ({
      tagName: tag,
      className: '',
      innerHTML: '',
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
      dataset: {}
    })),
    addEventListener: vi.fn()
  }
}