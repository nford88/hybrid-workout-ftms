import { useState, useEffect } from 'react'
import SetupView from '../views/SetupView'
import ActiveView from '../views/ActiveView'
import ConnectionPanel from '../trainer/ConnectionPanel'
import { useKeyboardActions } from '../../hooks/useKeyboardActions'
import { useFullscreen } from '../../hooks/useFullscreen'
import { useWakeLock } from '../../hooks/useWakeLock'

// main.js dispatches these events when workout starts/ends
const WORKOUT_STARTED = 'workoutStarted'
const WORKOUT_ENDED = 'workoutEnded'

interface Props {
  buildVersion: string
}

export default function AppShell({ buildVersion }: Props) {
  const [isActive, setIsActive] = useState(false)

  // Keyboard shortcuts for every Click action, so the app is fully usable — and the
  // shift path testable — with no hardware attached.
  useKeyboardActions()

  const { isFullscreen, supported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen()

  // Held only while a workout runs, so the laptop is not kept awake indefinitely afterwards.
  const wakeLock = useWakeLock(isActive)

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
    // The ride view drops the vertical padding: every pixel above the HUD is a pixel the graph
    // does not get, and the whole thing has to fit one screen without scrolling.
    <div className={`min-h-screen bg-app px-2 sm:px-4 ${isActive ? 'py-2' : 'py-4 sm:py-8'}`}>
      {/* Error toast — always rendered so main.js can find it */}
      <div
        id="error-message"
        className="fixed top-2 sm:top-4 right-2 sm:right-4 left-2 sm:left-auto bg-red-900/90 border border-red-700 text-red-200 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg hidden text-sm sm:text-base z-50"
      >
        <span id="error-text" />
      </div>

      {/* `max-w-4xl` (896px) is right for the setup form and wrong for the HUD — it wasted
          ~40% of a 1512px laptop screen and squeezed the graph. The ride view gets the width. */}
      <div className={`mx-auto ${isActive ? 'max-w-[1600px]' : 'max-w-4xl'}`}>
        <header
          className={`flex items-center justify-between ${isActive ? 'mb-2' : 'mb-6 sm:mb-8'}`}
        >
          <h1
            className={`font-bold text-white tracking-tight ${
              isActive ? 'text-lg' : 'text-2xl sm:text-3xl'
            }`}
          >
            FTMS <span className="text-cyan-400">Hybrid</span> Workout
          </h1>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* No LIVE badge here while riding — the HUD's own status strip carries it, and two
                of them a few hundred pixels apart is just noise. */}
            {/* Reclaims the browser chrome for the ride HUD. Needs a click to satisfy the
                Fullscreen API's user-gesture requirement, so it cannot be automatic. */}
            {fullscreenSupported && (
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-pressed={isFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen — hide the browser chrome'}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-sm text-gray-400 transition-colors hover:text-white hover:border-cyan-600"
              >
                <span aria-hidden="true">{isFullscreen ? '⤢' : '⛶'}</span>
                <span className="sr-only">{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
              </button>
            )}
          </div>
        </header>

        <ConnectionPanel compact={isActive} />
        <div className={isActive ? 'hidden' : ''}>
          <SetupView />
        </div>
        <div className={isActive ? '' : 'hidden'}>
          <ActiveView />
        </div>

        {/* A wake lock that silently failed is indistinguishable from one that worked until the
            screen goes black mid-ride, so say so while there is still time to nudge the trackpad
            or change a system setting. */}
        {isActive && !wakeLock.active && (
          <div className="mt-2 text-center text-xs text-amber-400">
            <span aria-hidden="true">▲</span>{' '}
            {wakeLock.supported
              ? `Screen may sleep mid-ride — wake lock not held${
                  wakeLock.error ? ` (${wakeLock.error})` : ''
                }`
              : 'Screen may sleep mid-ride — this browser has no wake lock'}
          </div>
        )}

        <footer className={`text-center text-xs text-gray-600 ${isActive ? 'py-1' : 'py-4 mt-4'}`}>
          Build: {buildVersion}
        </footer>
      </div>
    </div>
  )
}
