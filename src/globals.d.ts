// Global window extensions injected by main.js (vanilla JS) and ftms.js.
// These are typed loosely — ftms.js and main.js remain plain JS files.

interface IbdData {
  powerW?: number
  speedKph?: number
  cadenceRpm?: number
}

interface FtmsBridge {
  connect(opts?: { nameHint?: string; log?: (msg: string) => void }): Promise<void>
  setErgWatts(watts: number): Promise<void>
  setSim(params: { gradePct: number; crr?: number; cwa?: number; windMps?: number }): Promise<void>
  rampSim(params: {
    fromPct: number
    toPct: number
    stepPct?: number
    dwellMs?: number
  }): Promise<void>
  on(event: 'ibd', fn: (data: IbdData) => void): void
  on(event: 'ack', fn: (data: unknown) => void): void
  virtualGear: unknown
}

interface HybridBridge {
  handlers?: {
    connectTrainer?: () => void
    startWorkout?: () => void
    skipStep?: () => void
    endWorkout?: () => void
  }
}

declare interface Window {
  ftms?: FtmsBridge
  Hybrid?: HybridBridge
  __ftmsMock?: FtmsBridge
  lastWorkoutSummary?: unknown
}
