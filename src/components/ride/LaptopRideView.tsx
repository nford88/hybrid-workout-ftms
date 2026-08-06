import RideHud from './RideHud'
import MetricsRow from '../metrics/MetricsRow'
import WorkoutGraph from '../workout/WorkoutGraph'

/**
 * The ride screen, laid out for a laptop read at ~1.2 m while riding.
 *
 * Four rows, in priority order rather than reading order:
 *
 *   1. status      — connections and elapsed. Small.
 *   2. gear + step — the hero pair. The two things no other device shows.
 *   3. the graph   — given real height at last; it has been squeezed into 200 px.
 *   4. liveness    — MetricsRow, reused as-is. Deliberately the least prominent row: the
 *                    Garmin already shows power/cadence/speed, so these exist to prove the
 *                    data feed is alive, not to pace by.
 *
 * TWO STRUCTURAL RULES, both learned the hard way:
 *
 * - `main.js` captures its DOM references ONCE at import time into `H.dom`, so any element it
 *   holds must exist exactly once and must never unmount. That covers `#workout-graph` and its
 *   child groups, `#workout-progress-text` and `#target-display`. Re-mounting them leaves
 *   main.js writing to a detached node and the graph silently stops updating — which looks like
 *   a physics bug, not a React one.
 * - Consequently the graph lives here and ONLY here. Rendering `WorkoutGraph` in a second place
 *   would duplicate those ids and main.js would bind to whichever came first.
 */
export default function LaptopRideView() {
  return (
    // Sized to the viewport rather than min-height'd: the graph takes the slack via flex-1, and
    // the whole HUD has to fit one screen. A ride view that scrolls is a ride view whose bottom
    // half does not exist, because nobody scrolls at threshold.
    <div
      data-testid="ride-view"
      className="flex h-[calc(100vh-6.5rem)] min-h-120 flex-col justify-start overflow-hidden"
    >
      <RideHud />

      {/* Row 3 — the graph. `flex-1` lets it take the slack the heroes leave, which is the
          whole point of T8: the desktop `max-height: 200px` cap is lifted by `hud-graph`. */}
      {/* Sizes to content, NOT flex-1. The SVG preserves its 800x150 aspect ratio, so
          constraining its height makes it letterbox horizontally and waste the width we just
          fought for — letting width drive gives ~270px at laptop width, under the 34vh cap. */}
      <section className="hud-graph mb-3 flex flex-none flex-col rounded-xl border border-border bg-surface p-3">
        {/* Both legacy-bound readouts share the title row rather than bracketing the chart: a
            separate line under the graph cost ~30px, and the four rows have to add up to less
            than one screen. main.js writes into both.
            `#target-display` already arrives prefixed with "Target:", so it gets no label of its
            own — otherwise it reads "target Target: 210W". It is kept even though the hero
            derives its own target in React: if the two ever disagree, that is the bug to see. */}
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

      {/* Row 4 — liveness. `hud-metrics` tightens the shared cards for this context only. */}
      <div className="hud-metrics">
        <MetricsRow />
      </div>
    </div>
  )
}
