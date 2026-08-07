// Scoring for the experiment 19 keypad-gate arms — pure functions, no BLE dependency.
//
// Why this exists as its own module rather than inline in ble-lab.html: it converts a run
// into a VERDICT, and a silent bug here produces a confident wrong answer rather than an
// obvious failure. That is the exact class of defect experiments/15 §4 catalogued four of.
// Pure + unit-tested means the rig is trustworthy before the bench, not after.
//
// The model (docs/virtual-shifting/experiments/19-click-v2-challenge-and-gate.md §2): the
// Click's `23` keypad stream is PRESS-gated, running at ~11 Hz and stopping ~1.0 s after
// release. So frame absence alone means nothing — the healthy 2026-07-29 session has keypad
// silences of up to 136 s. The only evidence of a closed gate is "a press produced nothing",
// which is why a run cues each press and scores it.

/** Consecutive missed cues at the END of a run before we call the gate closed. */
export const GATE_MISS_RUN = 3

/**
 * @param {Array<{hit: boolean}>} cues in chronological order
 * @returns {{cues:number, hits:number, misses:number, trailingMisses:number,
 *            gateClosed:boolean, firstTrailingMissIndex:number|null}}
 */
export function scoreCues(cues) {
  let trailingMisses = 0
  for (let i = cues.length - 1; i >= 0 && !cues[i].hit; i -= 1) trailingMisses += 1

  const hits = cues.filter((c) => c.hit).length

  // Two guards, both load-bearing:
  //
  // 1. `trailingMisses < cues.length` — a run where NOTHING was ever hit is not a gate that
  //    closed, it is a gate that never opened (wrong unit, dead battery, operator not
  //    pressing). Those need different diagnoses, so they must not share a verdict.
  // 2. the run length threshold — an isolated miss mid-run is a fumbled press. Scoring that
  //    as a closure would have us chasing ghosts, and the failure we are hunting is a
  //    permanent gate, not a dropped frame.
  const gateClosed = trailingMisses >= GATE_MISS_RUN && trailingMisses < cues.length

  return {
    cues: cues.length,
    hits,
    misses: cues.length - hits,
    trailingMisses,
    gateClosed,
    firstTrailingMissIndex: gateClosed ? cues.length - trailingMisses : null,
  }
}

/**
 * Human-readable verdict. `endedEarly` wins over everything: an arm that lost its link or was
 * aborted has not measured what it set out to, and must not read as a clean result.
 */
export function verdictLine(summary) {
  if (summary.endedEarly) return `⚠️ ENDED EARLY — ${summary.endedEarly}`
  if (summary.cues === 0) return '⚠️ NO CUES — the arm ended before it cued a press'
  if (summary.hits === 0) {
    return `⚠️ NO CUE EVER HIT (0/${summary.cues}) — the gate never opened. Wrong unit, or no presses landed.`
  }
  if (summary.gateClosed) {
    // Prefer time-since-handshake: it is the only clock comparable across runs, because the
    // operator may start an arm any number of seconds after connecting.
    const where =
      summary.gateCloseSinceHandshakeS != null
        ? ` ${summary.gateCloseSinceHandshakeS}s after the handshake`
        : summary.uptimeAtGateCloseS != null
          ? ` at ${summary.uptimeAtGateCloseS}s uptime`
          : ''
    const link = summary.linkStillUp ? 'link STILL UP' : 'link down too'
    return `GATE CLOSED${where} — ${summary.trailingMisses} missed cues in a row, ${link}`
  }
  return `gate stayed OPEN for ${summary.durationS}s — ${summary.hits}/${summary.cues} cues hit`
}
