import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { LiveData } from '../types.js'

/**
 * TrainerContext — live trainer state and connection actions.
 *
 * Subscribes to window.ftms IBD events (speed, cadence, power) and tracks
 * whether a trainer is connected.  window.ftms is created by ftms.js which
 * main.js imports; we poll until it's available so this context doesn't depend
 * on load order.
 */

interface IbdData {
  powerW?: number
  speedKph?: number
  cadenceRpm?: number
}

interface TrainerContextValue {
  isConnected: boolean
  isConnecting: boolean
  liveData: LiveData
  connect: () => Promise<void>
}

const TrainerContext = createContext<TrainerContextValue | null>(null)

const LIVE_DEFAULTS: LiveData = { power: 0, speed: 0, cadence: 0 }

export function TrainerProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [liveData, setLiveData] = useState<LiveData>(LIVE_DEFAULTS)
  const subscribedRef = useRef(false)

  // Subscribe to IBD events once window.ftms is available
  useEffect(() => {
    let cancelled = false

    function trySubscribe() {
      if (cancelled) return
      if (!window.ftms) {
        setTimeout(trySubscribe, 100)
        return
      }
      if (subscribedRef.current) return
      subscribedRef.current = true
      ;(
        window.ftms as {
          connect(): Promise<void>
          on(event: string, fn: (data: IbdData) => void): void
        }
      ).on('ibd', (data: IbdData) => {
        setIsConnected(true)
        setLiveData({
          power: data.powerW ?? 0,
          speed: data.speedKph ?? 0,
          cadence: data.cadenceRpm ?? 0,
        })
      })
    }

    trySubscribe()
    return () => {
      cancelled = true
    }
  }, [])

  // Sync connection flag with events that main.js (and later this context) dispatches
  useEffect(() => {
    const onConnecting = () => setIsConnecting(true)
    const onConnected = () => {
      setIsConnected(true)
      setIsConnecting(false)
    }
    const onDisconnected = () => {
      setIsConnected(false)
      setIsConnecting(false)
      setLiveData(LIVE_DEFAULTS)
    }
    window.addEventListener('ftmsConnecting', onConnecting)
    window.addEventListener('ftmsConnected', onConnected)
    window.addEventListener('ftmsDisconnected', onDisconnected)
    return () => {
      window.removeEventListener('ftmsConnecting', onConnecting)
      window.removeEventListener('ftmsConnected', onConnected)
      window.removeEventListener('ftmsDisconnected', onDisconnected)
    }
  }, [])

  /**
   * Initiate BLE connection.  Delegates to main.js handler while it exists;
   * Step 8 will call window.ftms.connect() directly.
   */
  const connect = useCallback(async () => {
    if (
      (window.Hybrid as { handlers?: { connectTrainer?: () => void } })?.handlers?.connectTrainer
    ) {
      ;(window.Hybrid as { handlers?: { connectTrainer?: () => void } }).handlers!.connectTrainer!()
    } else if (window.ftms) {
      try {
        await (
          window.ftms as {
            connect(): Promise<void>
            on(event: string, fn: (data: IbdData) => void): void
          }
        ).connect()
        setIsConnected(true)
        window.dispatchEvent(new CustomEvent('ftmsConnected'))
      } catch (err) {
        console.error('[TrainerContext] connect failed:', err)
      }
    }
  }, [])

  return (
    <TrainerContext.Provider value={{ isConnected, isConnecting, liveData, connect }}>
      {children}
    </TrainerContext.Provider>
  )
}

export const useTrainer = () => {
  const ctx = useContext(TrainerContext)
  if (!ctx) throw new Error('useTrainer must be used inside <TrainerProvider>')
  return ctx
}
