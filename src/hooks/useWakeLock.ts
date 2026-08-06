import { useEffect, useRef, useState } from 'react'

/**
 * Hold a screen wake lock while a workout is running.
 *
 * Without this the display sleeps on its normal timeout mid-ride and the HUD — the whole point of
 * which is being glanceable from across the room — goes black at exactly the wrong moment.
 *
 * Two behaviours of the API that shape this code:
 *
 * - **The lock is released automatically whenever the document becomes hidden.** Tab away, or lock
 *   the screen manually, and it is gone; coming back does NOT restore it. Hence the
 *   `visibilitychange` listener, which re-requests rather than assuming.
 * - **It only prevents *automatic* sleep.** A deliberate manual lock still wins. That is a
 *   platform guarantee we cannot and should not fight.
 *
 * `error` is surfaced rather than swallowed: a wake lock that silently failed is indistinguishable
 * from one that worked until the screen goes black 20 minutes into a ride.
 */
export interface WakeLockState {
  /** True while a lock is actually held — not merely requested. */
  active: boolean
  supported: boolean
  /** Populated when a request was refused, so the UI can say so. */
  error: string | null
}

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', fn: () => void) => void
}

export function useWakeLock(enabled: boolean): WakeLockState {
  const supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { wakeLock?: unknown }).wakeLock === 'object'

  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    if (!enabled || !supported) return
    let cancelled = false

    async function acquire() {
      if (cancelled || document.visibilityState !== 'visible') return
      if (sentinelRef.current && !sentinelRef.current.released) return
      try {
        const wl = (
          navigator as unknown as {
            wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinelLike> }
          }
        ).wakeLock
        const sentinel = await wl.request('screen')
        if (cancelled) {
          void sentinel.release()
          return
        }
        sentinelRef.current = sentinel
        setActive(true)
        setError(null)
        // Fires for releases we did not ask for — the document going hidden, or the OS taking it.
        sentinel.addEventListener('release', () => setActive(false))
      } catch (e) {
        setActive(false)
        setError(e instanceof Error ? e.message : String(e))
        console.warn('[UI] Screen wake lock refused:', e)
      }
    }

    void acquire()

    // The lock does not survive the document being hidden, so re-take it on return.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const held = sentinelRef.current
      sentinelRef.current = null
      setActive(false)
      // Released explicitly when the workout ends: leaving it held would keep the laptop awake
      // indefinitely after a ride, which is a battery bug the user would never attribute to us.
      if (held && !held.released) void held.release()
    }
  }, [enabled, supported])

  return { active, supported, error }
}
