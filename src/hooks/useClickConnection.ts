import { useEffect, useState } from 'react'

export interface ClickConnection {
  connected: boolean
  battery: number | null
}

/**
 * The Zwift Click link state, published by `ClickSettings`.
 *
 * An event bridge rather than a context because the Click's own connection lives inside a panel
 * that must never unmount (AppShell keeps both views mounted and hides one with CSS), and
 * lifting that state would mean touching the BLE path currently under investigation for the
 * dies-at-workout-start bug.
 *
 * Starts `false` and only ever reflects what it has been told: a HUD that optimistically claims
 * "connected" before hearing anything would hide exactly the failure it exists to surface.
 */
export function useClickConnection(): ClickConnection {
  const [state, setState] = useState<ClickConnection>({ connected: false, battery: null })

  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as Partial<ClickConnection> | undefined
      if (!detail) return
      setState({
        connected: !!detail.connected,
        battery: typeof detail.battery === 'number' ? detail.battery : null,
      })
    }
    window.addEventListener('clickConnectionChanged', onChange)
    return () => window.removeEventListener('clickConnectionChanged', onChange)
  }, [])

  return state
}
