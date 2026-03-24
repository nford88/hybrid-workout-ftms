import { useState, useEffect } from 'react'
import SetupView from '../views/SetupView'
import ActiveView from '../views/ActiveView'
import ConnectionPanel from '../trainer/ConnectionPanel'

// main.js dispatches these events when workout starts/ends
const WORKOUT_STARTED = 'workoutStarted'
const WORKOUT_ENDED = 'workoutEnded'

interface Props {
  buildVersion: string
}

export default function AppShell({ buildVersion }: Props) {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    const onStart = () => setIsActive(true)
    const onEnd = () => setIsActive(false)
    window.addEventListener(WORKOUT_STARTED, onStart)
    window.addEventListener(WORKOUT_ENDED, onEnd)
    return () => {
      window.removeEventListener(WORKOUT_STARTED, onStart)
      window.removeEventListener(WORKOUT_ENDED, onEnd)
    }
  }, [])

  // Import main.js after React has mounted so all DOM IDs exist
  useEffect(() => {
    import('../../js/main.js')
  }, [])

  return (
    <div className="min-h-screen bg-app py-4 sm:py-8 px-2 sm:px-4">
      {/* Error toast — always rendered so main.js can find it */}
      <div
        id="error-message"
        className="fixed top-2 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto bg-red-900/90 border border-red-700 text-red-200 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg hidden text-sm sm:text-base z-50"
      >
        <span id="error-text" />
      </div>

      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            FTMS <span className="text-cyan-400">Hybrid</span> Workout
          </h1>
          {isActive && (
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-900/60 text-green-400 border border-green-700 animate-pulse">
              LIVE
            </span>
          )}
        </header>

        <ConnectionPanel />
        <div className={isActive ? 'hidden' : ''}>
          <SetupView />
        </div>
        <div className={isActive ? '' : 'hidden'}>
          <ActiveView />
        </div>

        <footer className="text-center text-xs text-gray-600 py-4 mt-4">
          Build: {buildVersion}
        </footer>
      </div>
    </div>
  )
}
