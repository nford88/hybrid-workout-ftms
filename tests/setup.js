// Test setup file
import { vi } from 'vitest'

// Mock global objects that don't exist in test environment
global.navigator = {
  bluetooth: undefined // Will be mocked per test as needed
}

global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}

// Mock console methods to reduce noise in tests (can be enabled per test)
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}

// Mock Date.now for consistent test timing
const mockNow = vi.fn(() => 1234567890000) // Fixed timestamp

// Properly mock Date object
vi.stubGlobal('Date', {
  ...Date,
  now: mockNow
})

// Mock Math object to ensure it's available
global.Math = Math

// Export the mock for tests to use
export { mockNow }