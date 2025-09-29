// Mock timer utilities for testing
import { vi } from 'vitest'

export class MockTimer {
  constructor() {
    this.timeouts = new Map()
    this.intervals = new Map()
    this.currentTime = 1234567890000 // Fixed start time
    this.timeoutId = 1
    this.intervalId = 1
  }

  // Mock setTimeout
  setTimeout(callback, delay) {
    const id = this.timeoutId++
    this.timeouts.set(id, {
      callback,
      delay,
      startTime: this.currentTime,
      triggered: false
    })
    return id
  }

  // Mock clearTimeout
  clearTimeout(id) {
    this.timeouts.delete(id)
  }

  // Mock setInterval
  setInterval(callback, delay) {
    const id = this.intervalId++
    this.intervals.set(id, {
      callback,
      delay,
      startTime: this.currentTime,
      lastTrigger: this.currentTime
    })
    return id
  }

  // Mock clearInterval
  clearInterval(id) {
    this.intervals.delete(id)
  }

  // Test utilities
  advanceTime(ms) {
    this.currentTime += ms

    // Trigger timeouts that should fire
    for (const [id, timeout] of this.timeouts.entries()) {
      if (!timeout.triggered && 
          this.currentTime >= timeout.startTime + timeout.delay) {
        timeout.triggered = true
        timeout.callback()
        this.timeouts.delete(id)
      }
    }

    // Trigger intervals that should fire
    for (const [id, interval] of this.intervals.entries()) {
      while (this.currentTime >= interval.lastTrigger + interval.delay) {
        interval.lastTrigger += interval.delay
        interval.callback()
      }
    }
  }

  getCurrentTime() {
    return this.currentTime
  }

  setCurrentTime(time) {
    this.currentTime = time
  }

  // Get active timers for testing
  getActiveTimeouts() {
    return Array.from(this.timeouts.keys())
  }

  getActiveIntervals() {
    return Array.from(this.intervals.keys())
  }

  clear() {
    this.timeouts.clear()
    this.intervals.clear()
  }
}

// Export factory and setup function
export function createMockTimer() {
  return new MockTimer()
}

export function setupTimerMocks(mockTimer) {
  vi.stubGlobal('setTimeout', mockTimer.setTimeout.bind(mockTimer))
  vi.stubGlobal('clearTimeout', mockTimer.clearTimeout.bind(mockTimer))
  vi.stubGlobal('setInterval', mockTimer.setInterval.bind(mockTimer))
  vi.stubGlobal('clearInterval', mockTimer.clearInterval.bind(mockTimer))
  vi.stubGlobal('Date', {
    ...Date,
    now: () => mockTimer.getCurrentTime()
  })
}