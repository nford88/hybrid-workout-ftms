import { useTrainer } from '../../context'

export default function ConnectionPanel() {
  const { isConnected, isConnecting } = useTrainer()

  const statusText = isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'

  return (
    <div className="section-card">
      <h2 className="section-title">Trainer Connection</h2>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 mb-4">
        <button id="connect-button" className="btn-connect">
          Connect Trainer
        </button>
        <button id="start-workout-button" className="btn-start">
          Start Workout
        </button>
        <button id="skip-step-button" className="btn-skip">
          Skip Step
        </button>
        <button
          id="debug-bluetooth-button"
          className="btn-debug"
          title="Open Bluetooth debugging tools"
        >
          🔧 BLE Debug
        </button>
      </div>

      <div className="text-sm sm:text-base text-gray-400 mb-2">Status: {statusText}</div>
    </div>
  )
}
