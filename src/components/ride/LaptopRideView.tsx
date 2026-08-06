import { useEffect, useState } from 'react'
import RideHud from './RideHud'
import MediaPanel from './MediaPanel'
import MetricsRow from '../metrics/MetricsRow'
import WorkoutGraph from '../workout/WorkoutGraph'
import { useWorkout } from '../../context'
import { loadMediaInput } from '../../services/storage'

/**
 * The ride screen, laid out for a laptop read at ~1.2 m while riding.
 *
 * Two modes:
 *
 * - **side** (default) — video and graph in a left column, gear + step heroes stacked in a right
 *   column, liveness across the bottom. Both readable at once.
 * - **expanded** — the video takes the screen and the HUD compresses to a ~110px band, with the
 *   graph and liveness row hidden. Driven by the "Expand video" button.
 *
 * THREE STRUCTURAL RULES, all learned the hard way:
 *
 * - `main.js` captures its DOM references ONCE at import time into `H.dom`, so any element it
 *   holds must exist exactly once and must never unmount. That covers `#workout-graph` and its
 *   child groups, `#workout-progress-text` and `#target-display`. Re-mounting them leaves main.js
 *   writing to a detached node and the graph silently stops updating — which reads as a physics
 *   bug, not a React one. When expanded the graph is therefore HIDDEN, never removed.
 * - The media iframe is mounted once and only its container resizes, so switching modes does not
 *   restart playback. This is why `MediaPanel` sits outside the mode branches.
 * - Rows are sized to add up to less than the viewport rather than to fight over it. `flex-1` plus
 *   `min-h-0` on a row whose content cannot shrink (a 220px numeral) makes it overlap its
 *   neighbour instead of shrinking.
 */

type Mode = 'side' | 'expanded'

export default function LaptopRideView() {
  const [mode, setMode] = useState<Mode>('side')
  const [mediaInput, setMediaInput] = useState('')

  /**
   * The video is mounted only once a workout is RUNNING.
   *
   * `AppShell` keeps both views permanently mounted and hides one with CSS, so without this gate
   * the iframe existed from page load: ~22 requests to YouTube fired before the rider had touched
   * anything, the player buffered (and autoplays muted) behind `display: none`, and a ride would
   * start with the video already minutes in — burning bandwidth and CPU next to the BLE pipeline
   * the whole time.
   *
   * Mounting on `isRunning` rather than on visibility keeps the guarantee that matters elsewhere:
   * the iframe is created once per ride and mode switches only change its container's classes, so
   * expanding or shrinking never restarts playback.
   */
  const { isRunning } = useWorkout()

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

  const expanded = mode === 'expanded'

  const expandButton = (
    <button
      type="button"
      data-testid="video-expand"
      onClick={() => setMode(expanded ? 'side' : 'expanded')}
      aria-pressed={expanded}
      title={expanded ? 'Shrink the video back beside the HUD' : 'Expand the video, hide the rest'}
      className="ml-3 shrink-0 rounded border border-border bg-surface-elevated px-2 py-0.5 text-xs text-gray-400 transition-colors hover:border-cyan-600 hover:text-white"
    >
      <span aria-hidden="true">{expanded ? '⤡' : '⤢'}</span>{' '}
      {expanded ? 'Shrink video' : 'Expand video'}
    </button>
  )

  return (
    <div
      data-testid="ride-view"
      className="flex h-[calc(100vh-5rem)] min-h-120 flex-col justify-start overflow-hidden"
    >
      {/* The band, only when expanded — it replaces the right-hand column's status strip. */}
      {expanded && <RideHud variant="band" modeToggle={expandButton} />}

      <div className={expanded ? 'mt-2 flex min-h-0 flex-1' : 'flex min-h-0 flex-1 gap-4'}>
        {/* Left column: video, and the graph beneath it. */}
        <div
          className={`flex min-h-0 min-w-0 flex-col ${expanded ? 'w-full' : 'w-[62%] shrink-0'}`}
          data-testid="media-column"
        >
          {/* A BOUNDED height, always — never `shrink-0` around a width-derived 16:9 box.
              That was the overlap bug: a 16:9 video derived from a 62%-wide column is ~500px
              tall, more than the column's height could absorb, so the content overflowed this
              flex row and the liveness strip below drew on top of the graph. Percentages of the
              row height cannot overflow it. */}
          <div className={expanded ? 'min-h-0 flex-1' : 'h-[56%] shrink-0'}>
            {isRunning && <MediaPanel input={mediaInput} />}
          </div>

          {/* Graph — hidden when expanded, NEVER unmounted (see the rules above). */}
          {/* Takes the slack the video leaves — `flex-1 min-h-0` is correct HERE, because unlike
              the video the graph genuinely can shrink (the SVG scales). `overflow-hidden` is the
              backstop: if it ever cannot shrink far enough it clips itself rather than spilling
              onto a sibling. */}
          <section
            className={`hud-graph mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface p-3 ${
              expanded ? 'hidden' : ''
            }`}
          >
            {/* Both legacy-bound readouts share the title row rather than bracketing the chart.
                `#target-display` arrives already prefixed with "Target:", so it gets no label of
                its own. Kept even though the hero derives its own target in React — if the two ever
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
        </div>

        {/* Right column: the HUD heroes, stacked. Hidden when expanded.
            `min-h-0 overflow-hidden` for the same reason as the graph — the gear numeral cannot
            shrink, so on a short viewport this must clip itself rather than overlap the liveness
            strip below. */}
        {/* `flex flex-col` so RideHud's hero stack has a height to distribute — without it the
            cards fall back to content size and clip. */}
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            expanded ? 'hidden' : ''
          }`}
        >
          {/* The button goes to whichever HUD is VISIBLE. This column is only CSS-hidden, never
              unmounted, so passing it unconditionally rendered two of them — a duplicate control
              and a duplicate test id. */}
          <RideHud variant="column" modeToggle={expanded ? undefined : expandButton} />
        </div>
      </div>

      {/* Liveness — kept in BOTH modes. The video wrapper is `flex-1`, so expanding takes what is
          left after this row rather than pushing it off; the row is a fixed cost either way.
          `hud-metrics` tightens the shared cards for this context. */}
      <div className="hud-metrics mt-3">
        <MetricsRow />
      </div>
    </div>
  )
}
