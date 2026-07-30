import { useEffect, useRef } from 'react'
import { actionForKey } from '../services/clickBindings'
import { loadKeyBindings } from '../services/storage'
import { dispatchAction } from '../services/clickActions'

/**
 * Global keyboard shortcuts for Click actions.
 *
 * Without this the key bindings were configuration that did nothing: they persisted, they
 * showed in the UI, and no listener existed. That also makes the app usable — and testable —
 * with no hardware attached, which matters when the Click is the thing you are debugging.
 */
export function useKeyboardActions(enabled = true): void {
  const bindings = useRef(loadKeyBindings())

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      // Never steal keys from text entry — the workout builder is full of inputs, and
      // "e" for ERG/SIM would otherwise be unusable in any name field.
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      // Leave browser and OS shortcuts alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const action = actionForKey(bindings.current, e.key)
      if (action === 'none') return
      e.preventDefault()
      const result = dispatchAction(action)
      window.dispatchEvent(new CustomEvent('clickActionPerformed', { detail: result }))
    }

    // Re-read bindings when the settings panel saves, so a rebind takes effect without a
    // page reload.
    function onStorage() {
      bindings.current = loadKeyBindings()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyBindingsChanged', onStorage)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyBindingsChanged', onStorage)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled])
}
