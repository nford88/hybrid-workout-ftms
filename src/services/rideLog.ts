/**
 * Structured ride recorder — the app's own flight data recorder.
 *
 * Exists because the console is not a usable record. The 2026-07-29 ride produced a 6,138-line
 * console dump that (a) had NO timestamps on any line, so aligning it with a Garmin FIT file
 * was guesswork from the workout's end time, and (b) had been truncated by the browser's
 * buffer to the last ~6 minutes of a 48-minute ride, leaving 5 usable `[SIM]` decisions out of
 * roughly 650. The interesting quantities — sent grade, gear, target power, route position —
 * exist ONLY here; a head unit cannot record them.
 *
 * Every event carries an absolute epoch timestamp so it can be joined to a FIT file's UTC
 * records exactly, rather than inferred.
 */

export interface RideLogSession {
  startedAt: number
  massKg: number
  crr: number
  cw: number
  chainringTeeth: number
  cogTeeth: number
  physicalRatio: number
  wheelCircumferenceM: number
  gearTable: readonly number[]
  userAgent: string
}

export type RideLogEvent =
  | { t: number; type: 'session'; session: RideLogSession }
  | {
      t: number
      type: 'sim'
      routeDistanceM: number | null
      rawGradePct: number
      realisticGradePct: number
      sentGradePct: number
      gearIndex: number
      gearRatio: number
      physicalRatio: number
      targetPowerW: number
      virtualSpeedKph: number
      coasting: boolean
      clamped: boolean
    }
  | { t: number; type: 'gear'; from: number; to: number; ratio: number; action: string }
  | { t: number; type: 'telemetry'; speedKph: number; cadenceRpm: number; powerW: number }
  | { t: number; type: 'step'; index: number; stepType: string; target: string }
  | { t: number; type: 'note'; note: string; data?: unknown }

/**
 * A 50-minute ride is roughly 3,000 telemetry + 650 sim events, so this cap is ~10x headroom.
 * It exists only so a forgotten tab cannot grow unbounded; hitting it is logged rather than
 * silently dropping the tail, because a silently-truncated log is what caused this problem.
 */
const MAX_EVENTS = 40000

let events: RideLogEvent[] = []
let overflowed = false
/** Telemetry arrives at ~2 Hz and is duplicated; 1 Hz is plenty to align against a FIT. */
let lastTelemetryAt = 0

export function startRideLog(session: Omit<RideLogSession, 'startedAt' | 'userAgent'>): void {
  events = []
  overflowed = false
  lastTelemetryAt = 0
  push({
    t: Date.now(),
    type: 'session',
    session: {
      ...session,
      startedAt: Date.now(),
      userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    },
  })
}

function push(e: RideLogEvent): void {
  if (events.length >= MAX_EVENTS) {
    if (!overflowed) {
      overflowed = true
      console.warn(`[RIDELOG] hit ${MAX_EVENTS} events — no longer recording`)
    }
    return
  }
  events.push(e)
}

export function logSim(e: Omit<Extract<RideLogEvent, { type: 'sim' }>, 't' | 'type'>): void {
  push({ t: Date.now(), type: 'sim', ...e })
}

export function logGear(from: number, to: number, ratio: number, action: string): void {
  push({ t: Date.now(), type: 'gear', from, to, ratio, action })
}

export function logStep(index: number, stepType: string, target: string): void {
  push({ t: Date.now(), type: 'step', index, stepType, target })
}

export function logNote(note: string, data?: unknown): void {
  push({ t: Date.now(), type: 'note', note, data })
}

export function logTelemetry(speedKph: number, cadenceRpm: number, powerW: number): void {
  const now = Date.now()
  if (now - lastTelemetryAt < 950) return
  lastTelemetryAt = now
  push({ t: now, type: 'telemetry', speedKph, cadenceRpm, powerW })
}

export function getRideLog(): RideLogEvent[] {
  return events
}

export function rideLogSummary(): { events: number; sim: number; gear: number; telemetry: number } {
  const count = (type: string) => events.filter((e) => e.type === type).length
  return {
    events: events.length,
    sim: count('sim'),
    gear: count('gear'),
    telemetry: count('telemetry'),
  }
}

export function rideLogJson(): string {
  return JSON.stringify(
    { version: 1, exportedAt: Date.now(), overflowed, events },
    null,
    isCompact() ? 0 : 1
  )
}

// A 40k-event log is ~8 MB pretty-printed and ~3 MB flat. Flat above a few thousand events.
function isCompact(): boolean {
  return events.length > 3000
}

/** Download the log. Falls back to the console if the DOM is unavailable. */
export function downloadRideLog(filename?: string): void {
  const json = rideLogJson()
  if (typeof document === 'undefined') {
    console.log('[RIDELOG]', json)
    return
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  a.download = filename ?? `ride-log-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
