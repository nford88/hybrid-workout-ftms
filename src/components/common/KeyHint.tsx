import { formatKeyLabel } from '../../services/clickBindings'

interface Props {
  /** A `KeyboardEvent.key` value, or null when the action has no key bound. */
  keyName: string | null
}

/**
 * The keyboard shortcut for a control, shown as a small keycap chip.
 *
 * Renders nothing when nothing is bound — an empty chip would imply a key exists. `endWorkout`
 * deliberately ships with no default key, so that case is normal rather than exceptional.
 *
 * Why bother: on the laptop HUD the rider drives everything from the Click, and the keyboard is
 * the fallback that demonstrably still worked on 2026-08-05 when the Click died mid-workout.
 * A fallback nobody can remember is not a fallback.
 */
export default function KeyHint({ keyName }: Props) {
  if (!keyName) return null
  return (
    // aria-hidden because the chip is a redundant visual cue: it would otherwise be folded
    // into the button's accessible name ("Start Workout Space"), and the shortcut belongs in
    // `aria-keyshortcuts` on the button itself — which is what the callers set.
    <kbd
      aria-hidden="true"
      className="ml-1.5 rounded border border-border bg-app px-1.5 py-0.5 font-mono text-[10px] leading-none text-hud-muted"
    >
      {formatKeyLabel(keyName)}
    </kbd>
  )
}
