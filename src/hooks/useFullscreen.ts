import { useCallback, useEffect, useState } from 'react'

/**
 * Fullscreen state for the ride view.
 *
 * Exists because the browser's own chrome — URL bar, tabs, bookmarks — eats the top of the
 * screen, and the HUD is read from across the room while riding. Reclaiming that strip is the
 * cheapest thing that makes the app read as an instrument rather than a web page.
 *
 * Not the Fullscreen API on the video element (there is no embedded video) and not a CSS
 * "fake fullscreen": this is the real thing on the document root, so the OS hides its own
 * furniture too.
 */
export function useFullscreen(): {
  isFullscreen: boolean
  supported: boolean
  toggle: () => void
} {
  // Initialised lazily rather than synced inside an effect, so the first paint is already
  // correct and no state is set during mount.
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && !!document.fullscreenElement
  )

  const supported =
    typeof document !== 'undefined' &&
    typeof document.documentElement?.requestFullscreen === 'function'

  useEffect(() => {
    // Covers exits we did not initiate — Esc, or the OS gesture — which would otherwise leave
    // the button showing the wrong state.
    const sync = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    // requestFullscreen REJECTS when it is not called from a user gesture. Swallow it with a
    // warning rather than letting an unhandled rejection land in the console — that console is
    // ride evidence, and noise in it has already cost this project a session's worth of log.
    document.documentElement.requestFullscreen().catch((err: unknown) => {
      console.warn('[UI] Fullscreen refused:', err instanceof Error ? err.message : err)
    })
  }, [])

  return { isFullscreen, supported, toggle }
}
