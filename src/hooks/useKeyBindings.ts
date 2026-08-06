import { useEffect, useState } from 'react'
import type { KeyBindings } from '../services/clickBindings'
import { loadKeyBindings } from '../services/storage'

/**
 * The current keyboard bindings, kept in sync with the settings panel.
 *
 * Read-only — `useKeyboardActions` owns dispatch; this is for *showing* the shortcut next to a
 * control. It re-reads on `keyBindingsChanged` for the same reason that hook does: a hint that
 * still shows the old key after a rebind is configuration that lies, which is the specific
 * failure mode this area of the codebase keeps guarding against.
 */
export function useKeyBindings(): KeyBindings {
  const [bindings, setBindings] = useState<KeyBindings>(loadKeyBindings)

  useEffect(() => {
    const reload = () => setBindings(loadKeyBindings())
    window.addEventListener('keyBindingsChanged', reload)
    // `storage` fires for changes made in ANOTHER tab; harmless here and keeps two open tabs
    // from disagreeing about what the keys do.
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener('keyBindingsChanged', reload)
      window.removeEventListener('storage', reload)
    }
  }, [])

  return bindings
}
