import { useEffect, useState } from 'react'
import RideHud from './RideHud'
import MediaPanel from './MediaPanel'
import MetricsRow from '../metrics/MetricsRow'
import WorkoutGraph from '../workout/WorkoutGraph'
import { loadMediaInput } from '../../services/storage'

/**
 * The ride screen, laid out for a laptop read at ~1.2 m while riding.
 *
 * Two modes, one layout:
 *
 * - **hud** — four rows: status, gear + step heroes, the graph at real height, liveness.
 * - **cinema** — the HUD compressed to a ~130px band above a full-width video.
 *
 * THREE STRUCTURAL RULES, all learned the hard way:
 *
 * - `main.js` captures its DOM references ONCE at import time into `H.dom`, so any element it
 *   holds must exist exactly once and must never unmount. That covers `#workout-graph` and its
 *   child groups, `#workout-progress-text` and `#target-display`. Re-mounting them leaves main.js
 *   writing to a detached node and the graph silently stops updating — which reads as a physics
 *   bug, not a React one. In cinema mode the graph is therefore HIDDEN, never removed.
 * - The media iframe is mounted once for the whole ride and only its container resizes. Swapping
 *   it out on a mode change restarts playback from the beginning.
 * - Rows are sized to add up to less than the viewport rather than to fight over it. `flex-1` plus
 *   `min-h-0` on a row whose content cannot shrink (a 227px numeral) makes it overlap its
 *   neighbour instead of shrinking.
 */

type Mode = 'hud' | 'cinema'

export default function LaptopRideView() {
  const [mode, setMode] = useState<Mode>('hud')
  const [mediaInput, setMediaInput] = useState('')

  // Read at mount and on change rather than at module load, so pasting a playlist in settings
  // takes effect without a reload — the same reason `useKeyBindings` listens for its event.
  useEffect(() => {
    const read = () => setMediaInput(loadMediaInput())
    read()
    window.addEventListener('mediaTargetChanged', read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener('mediaTargetChanged', read)
      window.removeEventListener('storage', read)
    }
  }, [])

  const cinema = mode === 'cinema'

  return (
    <div
      data-testid="ride-view"
      className="flex h-[calc(100vh-6.5rem)] min-h-120 flex-col justify-start overflow-hidden"
    >
      <RideHud
        variant={cinema ? 'band' : 'full'}
        modeToggle={
          <button
            type="button"
            data-testid="mode-toggle"
            onClick={() => setMode(cinema ? 'hud' : 'cinema')}
            aria-pressed={cinema}
            className="ml-3 shrink-0 rounded border border-border bg-surface-elevated px-2 py-0.5 text-xs text-gray-400 transition-colors hover:border-cyan-600 hover:text-white"
          >
            {cinema ? 'HUD' : 'Cinema'}
          </button>
        }
      />

      {/* Video. Mounted only in cinema mode — but note the iframe inside is never swapped once
          present, so switching back and forth within a ride does restart it. Accepted for now:
          keeping it alive in HUD mode would mean a hidden 1470px iframe decoding video for no
          reason, which is the bigger cost on a laptop running a BLE pipeline. */}
      {cinema && (
        <section className="mt-2 min-h-0 flex-1">
          <MediaPanel input={mediaInput} />
        </section>
      )}

      {/* Graph — hidden in cinema mode, NEVER unmounted (see the rules above). */}
      <section
        className={`hud-graph mb-3 flex flex-none flex-col rounded-xl border border-border bg-surface p-3 ${
          cinema ? 'hidden' : ''
        }`}
      >
        {/* Both legacy-bound readouts share the title row rather than bracketing the chart: a
            separate line under the graph cost ~30px, and the rows have to add up to less than one
            screen. `#target-display` arrives already prefixed with "Target:", so it gets no label
            of its own. Kept even though the hero derives its own target in React — if the two ever
            disagree, that disagreement is the bug worth seeing. */}
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="text-hud-label font-semibold uppercase tracking-wider text-hud-muted">
            Workout
          </h2>
          <div className="flex items-baseline gap-4">
            <span id="target-display" className="text-hud-label text-hud-muted">
              —
            </span>
            <span id="workout-progress-text" className="text-hud-sub text-gray-300">
              Ready to start workout
            </span>
          </div>
        </div>

        <WorkoutGraph />
      </section>

      {/* Liveness. Hidden in cinema mode — the band already carries power and cadence, and this is
          the row most easily given up for video. `hud-metrics` tightens the shared cards. */}
      <div className={`hud-metrics ${cinema ? 'hidden' : ''}`}>
        <MetricsRow />
      </div>
    </div>
  )
}
