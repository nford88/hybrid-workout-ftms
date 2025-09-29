// Mock FTMS client for testing
import { vi } from 'vitest'

export class MockFTMSClient {
  constructor() {
    this.connected = false
    this.callLog = []
    this.eventHandlers = new Map()
  }

  // Mock connection methods
  async connect(options = {}) {
    this.callLog.push({ method: 'connect', args: [options] })
    this.connected = true
    return Promise.resolve()
  }

  async disconnect() {
    this.callLog.push({ method: 'disconnect', args: [] })
    this.connected = false
    return Promise.resolve()
  }

  // Mock control methods
  async setErgWatts(watts) {
    this.callLog.push({ method: 'setErgWatts', args: [watts] })
    return Promise.resolve()
  }

  async setSim({ gradePct, crr = 0.004, cwa = 0.51, windMps = 0 }) {
    this.callLog.push({ 
      method: 'setSim', 
      args: [{ gradePct, crr, cwa, windMps }] 
    })
    return Promise.resolve()
  }

  async rampSim(options) {
    this.callLog.push({ method: 'rampSim', args: [options] })
    return Promise.resolve()
  }

  // Mock event handling
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event).push(handler)
    return () => this.off(event, handler)
  }

  off(event, handler) {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index >= 0) handlers.splice(index, 1)
    }
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || []
    handlers.forEach(handler => handler(data))
  }

  // Test utilities
  getCallLog() {
    return [...this.callLog]
  }

  clearCallLog() {
    this.callLog = []
  }

  getLastCall(method) {
    return this.callLog.filter(call => call.method === method).pop()
  }

  getCallCount(method) {
    return this.callLog.filter(call => call.method === method).length
  }

  // Simulate trainer data
  simulateTrainerData(data) {
    this.emit('ibd', {
      powerW: data.power || 0,
      speedKph: data.speed || 0,
      cadenceRpm: data.cadence || 0,
      raw: new ArrayBuffer(0)
    })
  }
}

// Export a factory function
export function createMockFTMS() {
  return new MockFTMSClient()
}