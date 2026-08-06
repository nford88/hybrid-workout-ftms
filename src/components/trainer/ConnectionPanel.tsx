import { useTrainer } from '../../context'
import { keyForAction } from '../../services/clickBindings'
import { useKeyBindings } from '../../hooks/useKeyBindings'
import KeyHint from '../common/KeyHint'

interface Props {
  /**
   * Collapse to a single strip of buttons for the ride view.
   *
   * The panel is NOT unmounted while riding, and must not be: `main.js` captures
   * `#connect-button`, `#start-workout-button` and `#skip-step-button` once at import time, so
   * removing them leaves it holding detached nodes. Only the chrome around them changes — and
   * it has to, because the full card cost ~180 px of vertical space that the HUD's graph needs.
   */
  compact?: boolean
}

export default function ConnectionPanel({ compact = false }: Props) {
  const { isConnected, isConnecting } = useTrainer()
  const keys = useKeyBindings()

  const statusText = isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'

  const startKey = keyForAction(keys, 'startWorkout')
  const skipKey = keyForAction(keys, 'nextStep')

  return (
    <div className={compact ? 'mb-2' : 'section-card'}>
      {!compact && <h2 className="section-title">Trainer Connection</h2>}

      <div
        className={
          compact
            ? 'flex flex-wrap items-center gap-2'
            : 'grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 mb-4'
        }
      >
        {/* Connecting mid-ride is not a thing you do on purpose, and the button is the one
            control that would cost a session if fat-fingered. Hidden, not removed. */}
        <button id="connect-button" className={`btn-connect ${compact ? 'hidden' : ''}`}>
          Connect Trainer
        </button>
        <button
          id="start-workout-button"
          className={`btn-start ${compact ? 'hidden' : ''}`}
          aria-keyshortcuts={startKey ?? undefined}
        >
          Start Workout
          <KeyHint keyName={startKey} />
        </button>
        <button id="skip-step-button" className="btn-skip" aria-keyshortcuts={skipKey ?? undefined}>
          Skip Step
          <KeyHint keyName={skipKey} />
        </button>
        <button
          id="debug-bluetooth-button"
          className={`btn-debug ${compact ? 'hidden' : ''}`}
          title="Open Bluetooth debugging tools"
        >
          🔧 BLE Debug
        </button>
      </div>

      {/* The HUD's status strip already reports the connection while riding. */}
      {!compact && (
        <div className="text-sm sm:text-base text-gray-400 mb-2">Status: {statusText}</div>
      )}
    </div>
  )
}
