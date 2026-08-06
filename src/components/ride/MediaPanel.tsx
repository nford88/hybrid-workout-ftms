import { useMemo } from 'react'
import { buildEmbedUrl, parseYouTubeTarget } from '../../services/youtube'

interface Props {
  /** Whatever the rider pasted — a URL or a bare ID. Parsed here, not stored parsed. */
  input: string
}

/**
 * The ride video.
 *
 * ONE iframe, mounted for the whole ride, whose CONTAINER is what resizes between HUD and cinema
 * mode. Re-creating the iframe on a mode change would restart playback from the beginning, which
 * is the same never-unmount discipline `AppShell` applies to the Click panel and `LaptopRideView`
 * applies to the graph — just with a different symptom.
 *
 * The `src` is memoised on the input string alone for that reason: any state that changed it would
 * reload the player. Mute/autoplay are therefore baked in at mount and adjusted later through the
 * IFrame API rather than by rewriting the URL.
 *
 * Deliberately NOT using the IFrame Player API yet. YouTube's own control bar is enough while the
 * laptop has a trackpad, and it avoids the global-singleton-plus-global-ready-callback problem that
 * React 19's double-mount creates. The API arrives when the Click drives playback (plan §4.2).
 */
export default function MediaPanel({ input }: Props) {
  const target = useMemo(() => parseYouTubeTarget(input), [input])
  const src = useMemo(() => (target ? buildEmbedUrl(target) : null), [target])

  if (!input.trim()) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-border bg-surface p-6 text-center text-hud-sub text-hud-muted">
        No ride video configured — paste a YouTube playlist or video URL in the Zwift Click panel.
      </div>
    )
  }

  if (!src) {
    // Says WHAT was rejected. "Invalid URL" with the offending value hidden is the kind of error
    // that gets rediscovered every few months.
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border border-red-800 bg-red-950/40 p-6 text-center">
        <div className="text-hud-sub font-semibold text-red-300">
          <span aria-hidden="true">▲</span> Not a YouTube URL or ID
        </div>
        <code className="max-w-full truncate text-xs text-red-400/80">{input}</code>
      </div>
    )
  }

  return (
    // Constrained to 16:9 and centred, rather than filled. Filling a wider-than-16:9 container
    // makes YouTube pillarbox INSIDE the iframe, so the black bars sit inside our rounded border
    // and the frame no longer hugs the picture.
    <div className="mx-auto aspect-video h-full max-h-full overflow-hidden rounded-xl border border-border bg-black">
      <iframe
        // A stable key: React must not be tempted to remount this on a re-render.
        key="ride-media"
        data-testid="media-frame"
        src={src}
        title="Ride video"
        className="h-full w-full"
        // `allow` grants only what playback needs. No camera, no microphone, no geolocation.
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        // Sandboxed, but `allow-presentation` is omitted: the app owns fullscreen (cinema mode),
        // and letting the frame take over the screen would cover the HUD.
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
