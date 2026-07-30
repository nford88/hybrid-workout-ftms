import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_CLICK_BUTTONS,
  CLICK_BUTTON_LABEL,
  buttonsForUnit,
  createButtonEdgeDetector,
  pressedButtons,
  unknownPressedBits,
} from '../../services/clickButtons'
import {
  ALL_CLICK_ACTIONS,
  CLICK_ACTION_LABEL,
  bindKey,
  keyForAction,
  unreachableActions,
  type ClickAction,
} from '../../services/clickBindings'
import {
  loadClickBindings,
  loadKeyBindings,
  saveClickBindings,
  saveKeyBindings,
} from '../../services/storage'
import {
  connectClick,
  isWebBluetoothAvailable,
  type ClickConnection,
} from '../../services/clickBle'
import { actionForButton } from '../../services/clickBindings'
import { dispatchAction, isImplemented } from '../../services/clickActions'
import {
  shiftUp,
  shiftDown,
  getVirtualGear,
  subscribeVirtualGear,
  reloadDrivetrain,
} from '../../services/virtualGearState'
import { loadDrivetrain, saveDrivetrain } from '../../services/storage'
import { downloadRideLog, rideLogSummary } from '../../services/rideLog'
import { drivetrainRatio, ZWIFT_GEAR_RATIOS } from '../../services/virtualDrivetrain'

/**
 * Zwift Click setup: connect, then walk the user through pressing every button so each one
 * lights up as it is seen.
 *
 * The walkthrough exists because the bit map cannot be assumed. Our own hardware disagrees
 * with every published table on three bits, and one of those errors (the "+" paddle) sat in
 * this project's code for a day wiring shift-up to the wrong button. Having the user press
 * each control once, and showing what arrived, turns that class of bug into something visible
 * in ten seconds.
 *
 * NOTE ON THE FLOW: there is deliberately only ONE connection. A Click pair has a primary and
 * a secondary, and the primary relays the secondary's buttons — so the right-hand unit is
 * never connected separately. Connecting it directly gets you a link that publishes nothing
 * and dies after ~61 s. See docs/virtual-shifting/CLICK-CONNECTION-ORDER.md.
 */

type Phase = 'idle' | 'connecting' | 'left' | 'right' | 'done'

function nearestLabel(config: { chainringTeeth: number; cogTeeth: number }): string {
  const ratio = drivetrainRatio(config)
  let best = 0
  for (let i = 1; i < ZWIFT_GEAR_RATIOS.length; i += 1) {
    if (Math.abs(ZWIFT_GEAR_RATIOS[i] - ratio) < Math.abs(ZWIFT_GEAR_RATIOS[best] - ratio)) {
      best = i
    }
  }
  return `${best + 1}/24 (${ZWIFT_GEAR_RATIOS[best].toFixed(2)})`
}

interface ClickStatus {
  connected: boolean
  bitmap: number | null
  error: string | null
}

export default function ClickSettings() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<ClickStatus>({
    connected: false,
    bitmap: null,
    error: null,
  })
  const [seen, setSeen] = useState<Record<string, number>>({})
  const [unknownBits, setUnknownBits] = useState<number[]>([])
  const [clickBindings, setClickBindings] = useState(loadClickBindings)
  const [keyBindings, setKeyBindings] = useState(loadKeyBindings)
  const [capturingKeyFor, setCapturingKeyFor] = useState<ClickAction | null>(null)
  const [silent, setSilent] = useState(false)
  const [battery, setBattery] = useState<number | null>(null)
  const [gear, setGear] = useState(getVirtualGear)
  const [drivetrain, setDrivetrain] = useState(loadDrivetrain)
  const detector = useRef(createButtonEdgeDetector())
  const connection = useRef<ClickConnection | null>(null)

  const bindingsRef = useRef(clickBindings)
  useEffect(() => {
    bindingsRef.current = clickBindings
  }, [clickBindings])

  useEffect(() => saveClickBindings(clickBindings), [clickBindings])
  useEffect(() => {
    saveKeyBindings(keyBindings)
    window.dispatchEvent(new Event('keyBindingsChanged'))
  }, [keyBindings])

  function updateDrivetrain(patch: Partial<typeof drivetrain>) {
    const next = { ...drivetrain, ...patch }
    setDrivetrain(next)
    saveDrivetrain(next)
    reloadDrivetrain()
  }

  // Track gear from the service, so the readout also reflects shifts triggered elsewhere
  // (keyboard, or the SIM loop learning the physical ratio and re-basing the start gear).
  useEffect(() => subscribeVirtualGear(setGear), [])

  // Disconnect on unmount so a stale GATT link cannot outlive the panel.
  useEffect(() => () => connection.current?.disconnect(), [])

  // Key capture for rebinding. Bound to the window so the user can press the key itself
  // rather than typing its name.
  useEffect(() => {
    if (!capturingKeyFor) return
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      if (e.key !== 'Escape') {
        setKeyBindings((b) => bindKey(b, e.key, capturingKeyFor as ClickAction))
      }
      setCapturingKeyFor(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [capturingKeyFor])

  const [lastAction, setLastAction] = useState<string | null>(null)

  function performAction(action: ClickAction) {
    const result = dispatchAction(action)
    if (action !== 'none') {
      setLastAction(`${CLICK_ACTION_LABEL[action]} — ${result.detail}`)
    }
  }

  const livePressed = useMemo(
    () => (status.bitmap === null ? [] : pressedButtons(status.bitmap)),
    [status.bitmap]
  )

  const leftDone = buttonsForUnit('left').every((id) => seen[id])
  const rightDone = buttonsForUnit('right').every((id) => seen[id])
  const stranded = unreachableActions(clickBindings, keyBindings)

  async function connect() {
    setPhase('connecting')
    setStatus({ connected: false, bitmap: null, error: null })
    setSilent(false)
    connection.current?.disconnect()
    detector.current.reset()
    setSeen({})
    try {
      connection.current = await connectClick({
        onButtons: (bitmap) => {
          setStatus((s) => ({ ...s, connected: true, bitmap }))
          setSilent(false)
          setUnknownBits(unknownPressedBits(bitmap))
          const { pressed } = detector.current.feed(bitmap)
          if (pressed.length) {
            setSeen((prev) => {
              const next = { ...prev }
              for (const id of pressed) next[id] = (next[id] ?? 0) + 1
              return next
            })
            // Read bindings from the ref, not from closure state: this callback is created
            // once at connect time and would otherwise dispatch against a stale map forever.
            for (const id of pressed) {
              performAction(actionForButton(bindingsRef.current, id))
            }
          }
        },
        onBattery: (level) => setBattery(level),
        onSilent: () => setSilent(true),
        onDisconnected: () => {
          setStatus((s) => ({ ...s, connected: false }))
          detector.current.reset()
        },
      })
      setStatus({ connected: true, bitmap: null, error: null })
      setPhase('left')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A cancelled chooser is a user choice, not a failure worth shouting about.
      setStatus({
        connected: false,
        bitmap: null,
        error: /cancelled|NotFoundError/i.test(message) ? null : message,
      })
      setPhase('idle')
    }
  }

  return (
    <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-blue-950/40 rounded-lg border border-blue-800/50">
      <h3 className="text-sm sm:text-base font-semibold text-blue-300 mb-1">Zwift Click</h3>
      {!isWebBluetoothAvailable() && (
        <p className="text-xs text-red-400 mb-3">
          This browser has no Web Bluetooth. Use Chrome or Edge — Firefox and Safari cannot connect
          to the Click at all.
        </p>
      )}

      <p className="text-xs text-gray-500 mb-3">
        Connect one controller. The pair relays — whichever unit you connect carries{' '}
        <strong>both</strong> controllers&apos; buttons, so there is nothing to pair twice.
      </p>

      {/* ── Connect ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button
          type="button"
          onClick={connect}
          disabled={phase === 'connecting'}
          className="btn-add text-sm"
        >
          {phase === 'connecting'
            ? 'Connecting…'
            : status.connected
              ? 'Reconnect'
              : 'Connect Click'}
        </button>
        <span className="text-xs font-mono text-gray-400">
          {status.connected ? '● connected' : '○ not connected'}
          {battery !== null ? ` · battery ${battery}%` : ''}
        </span>
      </div>

      {status.error && (
        <p className="text-xs text-red-400 mb-3">
          {status.error}
          <br />
          Press a button on the Click first — asleep, it doesn&apos;t advertise.
        </p>
      )}

      {/* The service reports this after a few seconds of post-handshake silence. */}
      {silent && (
        <p className="text-xs text-amber-400 mb-3">
          Connected and the handshake was accepted, but this controller is sending nothing —
          it&apos;s the pair&apos;s <strong>secondary</strong> unit, and its link will drop after
          about a minute. Press a button on the <strong>other</strong> controller and connect that
          one instead.
        </p>
      )}

      {/* ── Walkthrough ─────────────────────────────────────────────────── */}
      {phase !== 'idle' && phase !== 'connecting' && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-2">
            {!leftDone
              ? 'Press every button on the LEFT controller once.'
              : !rightDone
                ? 'Now press every button on the RIGHT controller — keep the same connection.'
                : 'All buttons detected. Assign actions below.'}
          </p>

          {(['left', 'right'] as const).map((unit) => (
            <div key={unit} className="mb-2">
              <div className="text-xs font-semibold text-gray-400 uppercase mb-1">
                {unit} controller
              </div>
              <div className="flex gap-2 flex-wrap">
                {buttonsForUnit(unit).map((id) => {
                  const detected = !!seen[id]
                  const held = livePressed.includes(id)
                  return (
                    <span
                      key={id}
                      data-testid={`click-btn-${id}`}
                      data-detected={detected ? 'yes' : 'no'}
                      className={[
                        'px-2 py-1 rounded text-xs border transition-colors',
                        held
                          ? 'bg-yellow-400 text-black border-yellow-300'
                          : detected
                            ? 'bg-green-900/60 text-green-300 border-green-700'
                            : 'bg-gray-800/60 text-gray-500 border-gray-700',
                      ].join(' ')}
                    >
                      {detected ? '✓ ' : '○ '}
                      {CLICK_BUTTON_LABEL[id]}
                      {seen[id] > 1 ? ` ×${seen[id]}` : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}

          {unknownBits.length > 0 && (
            <p className="text-xs text-amber-300 mt-2">
              Unrecognised button bit{unknownBits.length > 1 ? 's' : ''}:{' '}
              {unknownBits.map((b) => `0x${b.toString(16)}`).join(', ')} — your hardware has a
              control this build doesn&apos;t know about. Worth reporting.
            </p>
          )}
        </div>
      )}

      {/* ── Ride log ────────────────────────────────────────────────────── */}
      <div className="border-t pt-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <button
            type="button"
            onClick={() => downloadRideLog()}
            className="bg-gray-700 text-white px-2 py-1 rounded"
          >
            Download ride log (JSON)
          </button>
          <span className="font-mono text-gray-400">
            {(() => {
              const s = rideLogSummary()
              return s.events
                ? `${s.events} events · ${s.sim} grade decisions · ${s.gear} shifts`
                : 'nothing recorded yet — starts with the workout'
            })()}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Sent grade, gear, target power and route position with absolute timestamps. None of this
          is on a head unit, and the browser console truncates long rides — export this after every
          ride you want compared against a FIT file.
        </p>
      </div>

      {/* ── Physical drivetrain ─────────────────────────────────────────── */}
      <h4 className="text-xs font-semibold text-blue-300 mt-4 mb-1">Your bike&apos;s gear</h4>
      <p className="text-xs text-gray-500 mb-2">
        The real chainring and cog. With a Zwift Cog this is fixed, and it is what makes the
        baseline gear honest — in the matching virtual gear the trainer feels exactly like the road
        grade, with no calibration.
      </p>
      <div className="flex items-center gap-2 text-xs mb-3 flex-wrap">
        <label className="flex items-center gap-1">
          Chainring
          <input
            type="number"
            min={20}
            max={60}
            aria-label="Chainring teeth"
            className="form-input text-xs w-16"
            value={drivetrain.chainringTeeth}
            onChange={(e) => updateDrivetrain({ chainringTeeth: Number(e.target.value) })}
          />
          t
        </label>
        <span className="text-gray-600">/</span>
        <label className="flex items-center gap-1">
          Cog
          <input
            type="number"
            min={9}
            max={40}
            aria-label="Cog teeth"
            className="form-input text-xs w-16"
            value={drivetrain.cogTeeth}
            onChange={(e) => updateDrivetrain({ cogTeeth: Number(e.target.value) })}
          />
          t
        </label>
        <span className="font-mono text-gray-400">
          = {drivetrainRatio(drivetrain).toFixed(3)} · nearest virtual gear{' '}
          {gear.physicalRatio ? nearestLabel(drivetrain) : ''}
        </span>
      </div>

      {/* ── Live gear readout ───────────────────────────────────────────── */}
      <div className="text-xs font-mono text-gray-300 mb-3 p-2 rounded bg-black/30">
        Gear <strong>{gear.gearIndex + 1}</strong>/24 · ratio {gear.gearRatio.toFixed(2)} · your
        bike ≈ {gear.physicalRatio.toFixed(2)}
        {gear.physicalRatioInferred ? ' (measured)' : ' (assumed — pedal to measure)'}
        {gear.last && !gear.last.coasting
          ? ` · ${(gear.last.virtualSpeedMs * 3.6).toFixed(1)}kph · target ${gear.last.targetPowerW.toFixed(0)}W`
          : ''}
        {gear.last?.clamped ? ' · AT LIMIT' : ''}
      </div>

      {/* ── Button → action ─────────────────────────────────────────────── */}
      <h4 className="text-xs font-semibold text-blue-300 mt-4 mb-2">Button actions</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ALL_CLICK_BUTTONS.map((id) => (
          <label key={id} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-gray-400">{CLICK_BUTTON_LABEL[id]}</span>
            <select
              className="form-select text-xs flex-1"
              aria-label={`Action for ${CLICK_BUTTON_LABEL[id]}`}
              value={clickBindings[id]}
              onChange={(e) =>
                setClickBindings((b) => ({ ...b, [id]: e.target.value as ClickAction }))
              }
            >
              {ALL_CLICK_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {CLICK_ACTION_LABEL[a]}
                  {a !== 'none' && !isImplemented(a) ? ' (not wired yet)' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* ── Keyboard equivalents ────────────────────────────────────────── */}
      <h4 className="text-xs font-semibold text-blue-300 mt-4 mb-1">Keyboard equivalents</h4>
      <p className="text-xs text-gray-500 mb-2">
        Every action also has a key, so the app is fully usable without the hardware. Click a key to
        rebind it, then press the new key (Esc cancels).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ALL_CLICK_ACTIONS.filter((a) => a !== 'none').map((action) => {
          const key = keyForAction(keyBindings, action)
          return (
            <div key={action} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 text-gray-400">{CLICK_ACTION_LABEL[action]}</span>
              <button
                type="button"
                aria-label={`Rebind key for ${CLICK_ACTION_LABEL[action]}`}
                onClick={() => setCapturingKeyFor(action)}
                className="px-2 py-1 rounded border border-gray-700 bg-gray-800/60 font-mono flex-1 text-left"
              >
                {capturingKeyFor === action
                  ? 'press a key…'
                  : key === ' '
                    ? 'Space'
                    : (key ?? '— unassigned —')}
              </button>
            </div>
          )
        })}
      </div>

      {stranded.length > 0 && (
        <p className="text-xs text-amber-300 mt-3">
          No button or key triggers: {stranded.map((a) => CLICK_ACTION_LABEL[a]).join(', ')}
        </p>
      )}
    </div>
  )
}
