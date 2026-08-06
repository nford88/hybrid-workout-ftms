import { useEffect, useState } from 'react'
import { useRoute, useTrainer, useWorkout } from '../../context'
import { useClickConnection } from '../../hooks/useClickConnection'
import { getGradeForDistance } from '../../services/routeService'
import { describeCurrentStep } from '../../services/workoutService'
import { subscribeVirtualGear, type VirtualGearSnapshot } from '../../services/virtualGearState'
import { ZWIFT_GEAR_RATIOS } from '../../services/virtualDrivetrain'
import { formatTime } from '../../utils/time'

/**
 * The ride HUD: status strip and the gear / current-step hero pair.
 *
 * Deliberately NOT a vital-signs display. Power, cadence, speed and heart rate are already on
 * the Garmin Edge on the handlebars, so putting them front and centre here would spend the best
 * pixels on a duplicate. This shows the things nothing else can: the virtual gear, what the
 * current workout step is asking for, and how far through it the rider is.
 *
 * Sized for a laptop screen read at roughly 1.2 m while riding — see the `--text-hud-*` scale in
 * main.css. Those sizes look absurd at desk distance; that is the point.
 */

function StatusDot({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-hud-label uppercase tracking-wider">
      <span
        // A ring rather than colour alone, so the state survives a colour-blind reading and a
        // hurried glance.
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          on ? 'bg-green-400 ring-2 ring-green-400/30' : 'bg-red-600 ring-2 ring-red-600/30'
        }`}
      />
      <span className={on ? 'text-hud-muted' : 'font-semibold text-red-400'}>{label}</span>
    </span>
  )
}

interface Props {
  /**
   * `full`   — gear and step side by side, for the full-width HUD with no video.
   * `column` — the same heroes stacked, for the narrow right-hand column beside a video. Needed
   *            because `full`'s two-column grid keys off a VIEWPORT breakpoint, so it would stay
   *            two-up inside a 560px column.
   * `band`   — one compressed strip above an expanded video. A genuine budget, not a style: the
   *            gear numeral is 220px in `full` and the whole band has to fit ~110px.
   */
  variant?: 'full' | 'column' | 'band'
  /**
   * Rendered inline in the status strip / band rather than on a row of its own — a dedicated row
   * for one small button cost ~40px of the vertical budget.
   */
  modeToggle?: React.ReactNode
}

export default function RideHud({ variant = 'full', modeToggle }: Props) {
  const { isConnected, liveData } = useTrainer()
  const click = useClickConnection()
  const { isRunning, workoutStartTime, currentStepIndex, stepStartTime, simDistanceTraveled } =
    useWorkout()
  const { workoutPlan, route, preprocessedRoute } = useRoute()

  const [gear, setGear] = useState<VirtualGearSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => subscribeVirtualGear(setGear), [])

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const elapsedSec = isRunning && workoutStartTime ? Math.floor((now - workoutStartTime) / 1000) : 0

  const distanceM = simDistanceTraveled || 0
  const grade =
    preprocessedRoute.length > 0 ? getGradeForDistance(distanceM, preprocessedRoute) : null

  const step = describeCurrentStep({
    step: workoutPlan[currentStepIndex],
    nextStep: workoutPlan[currentStepIndex + 1],
    isRunning,
    elapsedSecInStep: stepStartTime ? (now - stepStartTime) / 1000 : 0,
    distanceM,
    routeTotalM: route?.totalDistance ?? 0,
    gradePct: grade !== null && Number.isFinite(grade) ? grade : null,
    formatDuration: formatTime,
  })

  const clamped = !!gear?.last?.clamped
  const gearTone = clamped ? 'text-amber-400' : 'text-orange-400'

  // ── Cinema band ─────────────────────────────────────────────────────────────
  // Same information, one strip. Everything that can be folded onto a shared line is: the
  // liveness readouts join the status dots, and the step's own progress bar carries the
  // remaining time instead of a separate row for each.
  if (variant === 'band') {
    return (
      <div
        data-testid="hud-band"
        className="flex items-stretch gap-4 rounded-xl border border-border bg-surface px-4 py-2"
      >
        {/* Gear — still the anchor, just no longer 227px. */}
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-hud-label uppercase tracking-wider text-hud-muted">Gear</span>
          <span
            data-testid="hud-gear"
            className={`text-hud-band font-extrabold leading-none tabular-nums ${gearTone}`}
          >
            {gear ? gear.gearIndex + 1 : '—'}
          </span>
          <span className="text-hud-label tabular-nums text-hud-muted">
            /{ZWIFT_GEAR_RATIOS.length}
            {gear && ` · ${gear.gearRatio.toFixed(2)}`}
          </span>
          {clamped && (
            <span
              data-testid="hud-gear-clamped"
              className="text-hud-label font-semibold uppercase text-amber-400"
            >
              <span aria-hidden="true">▲</span> clamped
            </span>
          )}
        </div>

        {/* Step: badge, name, target, remaining, and both bars stacked thin. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-baseline gap-2 text-hud-sub">
            {step.kind && (
              <span
                className={`rounded px-1.5 text-hud-label font-bold uppercase tracking-wider ${
                  step.kind === 'SIM'
                    ? 'bg-orange-900/50 text-orange-400'
                    : 'bg-cyan-900/50 text-cyan-400'
                }`}
              >
                {step.kind}
              </span>
            )}
            <span className="truncate font-semibold text-white">
              {step.label || 'Ready to start'}
            </span>
            <span
              data-testid="hud-target"
              className={`ml-auto shrink-0 font-extrabold tabular-nums ${
                step.kind === 'SIM' ? 'text-red-400' : 'text-cyan-400'
              }`}
            >
              {step.targetValue}
              <span className="ml-1 text-hud-label font-normal text-hud-muted">
                {step.targetUnit}
              </span>
            </span>
            <span data-testid="hud-remaining" className="shrink-0 tabular-nums text-gray-200">
              {step.remaining}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              data-testid="hud-step-progress"
              data-progress={step.progressPct.toFixed(2)}
              className={`h-2 rounded-full transition-[width] duration-1000 ${
                step.kind === 'SIM' ? 'bg-orange-500' : 'bg-cyan-500'
              }`}
              style={{ width: `${step.progressPct}%` }}
            />
          </div>
          <div className="flex items-baseline gap-3 text-hud-label text-hud-muted">
            <StatusDot label="Trn" on={isConnected} />
            <StatusDot label="Clk" on={click.connected} />
            <span className="tabular-nums text-cyan-400">{liveData.power} W</span>
            <span className="tabular-nums text-yellow-400">{Math.round(liveData.cadence)} rpm</span>
            {step.next && <span className="truncate">next: {step.next}</span>}
            <span className="ml-auto shrink-0 tabular-nums text-purple-400">
              {isRunning ? formatTime(elapsedSec) : '—'}
            </span>
            {modeToggle}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── Row 1: status ───────────────────────────────────────────────── */}
      <div
        data-testid="hud-status"
        className="flex items-center gap-4 px-1 pb-3 text-hud-label sm:gap-6"
      >
        <StatusDot label="Trainer" on={isConnected} />
        <StatusDot label="Shifter" on={click.connected} />
        {click.battery !== null && <span className="text-hud-muted">{click.battery}%</span>}
        {isRunning && (
          <span className="rounded-full border border-green-700 bg-green-900/60 px-2 py-0.5 font-semibold text-green-400">
            LIVE
          </span>
        )}
        <span className="ml-auto tabular-nums text-purple-400" data-testid="hud-elapsed">
          {isRunning ? formatTime(elapsedSec) : '—'}
        </span>
        {modeToggle}
      </div>

      {/* ── Row 2: gear + current step ──────────────────────────────────── */}
      {/* DISTRIBUTES the available height rather than sizing to content.
          `grid-cols-1` with natural rows could not resize: the two cards took whatever their
          content wanted, overflowed the fixed-height column, and got clipped by its
          `overflow-hidden` — losing the bottom of the step card. As a flex column with two
          `flex-1` children they split whatever height the column has, and the numerals inside are
          `min(vw, vh)`-bounded so they shrink with it instead of forcing an overflow. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Gear — the largest thing on screen. It is what the rider acts on, and the only place
            it is shown at all. */}
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-xl border border-border bg-surface p-3 text-center">
          <h3 className="text-hud-label font-semibold uppercase tracking-wider text-hud-muted">
            Gear
          </h3>
          <div className="flex items-baseline justify-center gap-2">
            <span
              data-testid="hud-gear"
              className={`text-hud-hero font-extrabold leading-none tabular-nums ${gearTone}`}
            >
              {gear ? gear.gearIndex + 1 : '—'}
            </span>
            <span className="text-hud-sub tabular-nums text-hud-muted">
              /{ZWIFT_GEAR_RATIOS.length}
            </span>
          </div>
          {gear && (
            <div className="mt-2 text-hud-sub tabular-nums text-hud-muted">
              ratio {gear.gearRatio.toFixed(2)}
              <span className="ml-2 opacity-70">phys {gear.physicalRatio.toFixed(2)}</span>
            </div>
          )}
          {clamped && (
            // Says the word, not just amber: the model wants more resistance than the ±25%
            // grade clamp can deliver, so the rider is getting less than the gear implies.
            // Colour alone is invisible to anyone who does not know the palette.
            <div
              data-testid="hud-gear-clamped"
              className="mt-1 flex items-center justify-center gap-1 text-hud-label font-semibold uppercase tracking-wider text-amber-400"
            >
              <span aria-hidden="true">▲</span> clamped
            </div>
          )}
        </div>

        {/* Current step — what is being asked for, and how much of it is left. */}
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 flex items-center gap-3">
            {step.kind && (
              <span
                className={`rounded-full px-2 py-0.5 text-hud-label font-bold uppercase tracking-wider ${
                  step.kind === 'SIM'
                    ? 'bg-orange-900/50 text-orange-400'
                    : 'bg-cyan-900/50 text-cyan-400'
                }`}
              >
                {step.kind}
              </span>
            )}
            <span className="truncate text-hud-name font-semibold text-white">
              {step.label || 'Ready to start'}
            </span>
          </div>

          <div className="flex items-baseline gap-3">
            <span
              data-testid="hud-target"
              className={`text-hud-major font-extrabold leading-none tabular-nums ${
                step.kind === 'SIM' ? 'text-red-400' : 'text-cyan-400'
              }`}
            >
              {step.targetValue}
            </span>
            <span className="text-hud-sub text-hud-muted">{step.targetUnit}</span>
          </div>

          <div data-testid="hud-remaining" className="mt-3 text-hud-mid tabular-nums text-gray-200">
            {step.remaining}
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-border">
            <div
              data-testid="hud-step-progress"
              data-progress={step.progressPct.toFixed(2)}
              className={`h-3 rounded-full transition-[width] duration-1000 ${
                step.kind === 'SIM' ? 'bg-orange-500' : 'bg-cyan-500'
              }`}
              style={{ width: `${step.progressPct}%` }}
            />
          </div>

          {/* Prefigures the next step so the rider can prepare instead of react. */}
          <div className="mt-2 h-6 text-hud-sub text-hud-muted">
            {step.next && <>next: {step.next}</>}
          </div>
        </div>
      </div>
    </>
  )
}
