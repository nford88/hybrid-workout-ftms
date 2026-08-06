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

export default function RideHud() {
  const { isConnected } = useTrainer()
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
      </div>

      {/* ── Row 2: gear + current step ──────────────────────────────────── */}
      {/* Natural height, and deliberately NOT `flex-1 min-h-0`: that let the grid shrink below
          its content, and the gear number does not shrink, so the graph overlapped it. Rows 1-4
          are sized to add up to less than the viewport instead of fighting over it. */}
      <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-[38fr_62fr]">
        {/* Gear — the single largest thing on screen. It is what the rider acts on, and the
            only place it is shown at all. */}
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface p-4 text-center">
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
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface p-4">
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
