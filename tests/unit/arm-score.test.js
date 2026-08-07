import { describe, it, expect } from 'vitest'
import { scoreCues, verdictLine, GATE_MISS_RUN } from '../../src/dev/protocols/armScore.js'

const cues = (pattern) => [...pattern].map((c) => ({ hit: c === 'H' }))

describe('scoreCues', () => {
  it('counts hits and misses', () => {
    const s = scoreCues(cues('HHHMH'))
    expect(s.cues).toBe(5)
    expect(s.hits).toBe(4)
    expect(s.misses).toBe(1)
  })

  it('calls the gate closed on a trailing run of misses', () => {
    const s = scoreCues(cues('HHHHHMMM'))
    expect(s.gateClosed).toBe(true)
    expect(s.trailingMisses).toBe(3)
    // The gate closed at the FIRST of the trailing misses, not the last — that index is what
    // the report turns into "uptime at gate closure", so an off-by-one here would misdate it
    // by a full cue interval (10 s at the bench cadence).
    expect(s.firstTrailingMissIndex).toBe(5)
  })

  it('does NOT call the gate closed on an isolated fumbled press', () => {
    expect(scoreCues(cues('HHMHHHH')).gateClosed).toBe(false)
    expect(scoreCues(cues('HHMMHHHH')).gateClosed).toBe(false)
  })

  it('needs a full run of misses, not one short of it', () => {
    const short = cues('HHHHH' + 'M'.repeat(GATE_MISS_RUN - 1))
    const exact = cues('HHHHH' + 'M'.repeat(GATE_MISS_RUN))
    expect(scoreCues(short).gateClosed).toBe(false)
    expect(scoreCues(exact).gateClosed).toBe(true)
  })

  it('does not call an all-miss run a closed gate', () => {
    // A gate that never OPENED is a different diagnosis — wrong unit, dead battery, operator
    // not pressing — and must not be reported as the failure we are hunting.
    const s = scoreCues(cues('MMMMMM'))
    expect(s.gateClosed).toBe(false)
    expect(s.hits).toBe(0)
    expect(verdictLine({ ...s, endedEarly: null })).toContain('NO CUE EVER HIT')
  })

  it('handles an empty run without dividing by zero or claiming a result', () => {
    const s = scoreCues([])
    expect(s).toMatchObject({ cues: 0, hits: 0, misses: 0, trailingMisses: 0, gateClosed: false })
    expect(s.firstTrailingMissIndex).toBeNull()
  })

  it('scores a run that never misses as wide open', () => {
    const s = scoreCues(cues('HHHHHHHHHHHHHHHHHHHHHHHH'))
    expect(s.gateClosed).toBe(false)
    expect(s.trailingMisses).toBe(0)
    expect(s.firstTrailingMissIndex).toBeNull()
  })

  it('reproduces the 2026-08-07 shape: healthy pressing, then a hard stop', () => {
    // 24 cues at 10 s = 240 s. The 08-07 gate closed ~52 s in, i.e. after ~5 cues.
    const s = scoreCues(cues('HHHHH' + 'M'.repeat(19)))
    expect(s.gateClosed).toBe(true)
    expect(s.firstTrailingMissIndex).toBe(5)
    expect(s.hits).toBe(5)
  })
})

describe('verdictLine', () => {
  const base = { cues: 10, hits: 7, durationS: 240, linkStillUp: true, endedEarly: null }

  it('reports an early end above everything else, even with a clean-looking score', () => {
    // An arm that lost its link has not measured idle survival, and a "gate stayed open"
    // reading off a truncated run is exactly the false negative that would send us chasing
    // the wrong arm next.
    const line = verdictLine({
      ...base,
      ...scoreCues(cues('HHHHHHHHHH')),
      endedEarly: 'link dropped',
    })
    expect(line).toContain('ENDED EARLY')
    expect(line).not.toContain('stayed OPEN')
  })

  it('names the uptime when the gate closed and nothing better is available', () => {
    const s = { ...base, ...scoreCues(cues('HHHHHHHMMM')), uptimeAtGateCloseS: 71.4 }
    expect(verdictLine(s)).toContain('71.4s uptime')
    expect(verdictLine(s)).toContain('link STILL UP')
  })

  it('prefers time-since-handshake over uptime, because only that is comparable', () => {
    // 2026-08-07 run 2 pressed "Run arm" 35 s after connecting, so its 60.4 s gate closure
    // was reported as "95.5 s uptime" — not comparable with a run that started immediately.
    const s = {
      ...base,
      ...scoreCues(cues('HHHHHHHMMM')),
      uptimeAtGateCloseS: 95.5,
      gateCloseSinceHandshakeS: 60.4,
    }
    expect(verdictLine(s)).toContain('60.4s after the handshake')
    expect(verdictLine(s)).not.toContain('95.5')
  })

  it('distinguishes a gate closing from the whole link dying', () => {
    const s = {
      ...base,
      ...scoreCues(cues('HHHHHHHMMM')),
      uptimeAtGateCloseS: 61,
      linkStillUp: false,
    }
    expect(verdictLine(s)).toContain('link down too')
  })

  it('reports a clean open run', () => {
    expect(verdictLine({ ...base, ...scoreCues(cues('HHHHHHHHHH')) })).toContain('stayed OPEN')
  })

  it('flags a run that ended before cueing anything', () => {
    expect(verdictLine({ ...base, ...scoreCues([]) })).toContain('NO CUES')
  })
})
