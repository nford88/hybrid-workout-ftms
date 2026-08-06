/**
 * youtube.ts — parse what the user pasted, and build an embed URL from it.
 *
 * Pure: no DOM, no iframe, no network. The iframe itself is untestable in CI, so everything that
 * CAN be decided without one is decided here — which is the same reason `simPhysics` and
 * `clickButtons` are shaped this way.
 *
 * The input is "whatever the rider copied out of the address bar", which in practice means any of
 * half a dozen URL shapes plus bare IDs. Getting this wrong fails at the worst moment: a
 * mistyped playlist shows an empty player mid-ride with no explanation.
 */

export type YouTubeTarget =
  | { kind: 'playlist'; playlistId: string; videoId: string | null }
  | { kind: 'video'; videoId: string }

/**
 * Video IDs are exactly 11 characters of the URL-safe base64 alphabet. The exactness matters:
 * it is what lets us tell a video ID from a playlist ID when someone pastes a bare string.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Playlist IDs are longer and prefixed by type — PL user-created, UU channel uploads, OLAK auto
 * albums, RD radio, LL likes, FL favourites. Length varies (13–48 seen in the wild), so the
 * prefix carries the identification rather than the length.
 */
const PLAYLIST_ID = /^(PL|UU|OLAK|RD|LL|FL|TL)[A-Za-z0-9_-]{10,}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
])

function fromIds(videoId: string | null, playlistId: string | null): YouTubeTarget | null {
  // A playlist wins when both are present. Pasting a "watch?v=…&list=…" URL means "play this
  // list, starting here" — treating it as a single video would silently drop the rest.
  if (playlistId && PLAYLIST_ID.test(playlistId)) {
    return {
      kind: 'playlist',
      playlistId,
      videoId: videoId && VIDEO_ID.test(videoId) ? videoId : null,
    }
  }
  if (videoId && VIDEO_ID.test(videoId)) return { kind: 'video', videoId }
  return null
}

/**
 * Parse a pasted URL or bare ID. Returns null for anything unrecognised — never a guess, because
 * a wrong guess becomes an empty player with no error to explain it.
 */
export function parseYouTubeTarget(input: string): YouTubeTarget | null {
  const raw = input.trim()
  if (!raw) return null

  // Bare IDs, checked before URL parsing: an 11-char video ID is a valid relative URL and would
  // otherwise be swallowed by the parser below.
  if (VIDEO_ID.test(raw)) return { kind: 'video', videoId: raw }
  if (PLAYLIST_ID.test(raw)) return { kind: 'playlist', playlistId: raw, videoId: null }

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  // Host allow-list rather than a substring check: `youtube.com.evil.test` must not pass.
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null

  const list = url.searchParams.get('list')

  // youtu.be/<id> and /embed/<id> and /shorts/<id> carry the video in the path.
  const path = url.pathname.replace(/^\/+/, '')
  const segments = path.split('/')
  let pathVideo: string | null = null
  if (url.hostname.toLowerCase() === 'youtu.be') {
    pathVideo = segments[0] ?? null
  } else if (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'v') {
    pathVideo = segments[1] ?? null
  }

  return fromIds(url.searchParams.get('v') ?? pathVideo, list)
}

export interface EmbedOptions {
  /** Start muted. Required for autoplay without a user gesture on every current browser. */
  muted?: boolean
  autoplay?: boolean
  /** Loop the whole playlist rather than stopping at the end — right for ambient ride video. */
  loop?: boolean
}

/**
 * Build the embed URL for a target.
 *
 * `youtube-nocookie.com` because there is no reason for a trainer app to hand YouTube tracking
 * cookies. `fs=0` because the app owns its own cinema mode: YouTube's native fullscreen would
 * cover the HUD, which defeats the point of having the video and the gear on one screen.
 */
export function buildEmbedUrl(target: YouTubeTarget, options: EmbedOptions = {}): string {
  const { muted = true, autoplay = true, loop = true } = options

  const params = new URLSearchParams({
    fs: '0', // no native fullscreen — cinema mode is ours
    rel: '0', // no "related videos" from other channels at the end
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '1', // required for programmatic play/pause/next from the Click
    autoplay: autoplay ? '1' : '0',
    mute: muted ? '1' : '0',
  })

  if (target.kind === 'playlist') {
    params.set('listType', 'playlist')
    params.set('list', target.playlistId)
    if (loop) params.set('loop', '1')
    // Starting video, when the pasted URL named one.
    const base = target.videoId
      ? `https://www.youtube-nocookie.com/embed/${target.videoId}`
      : 'https://www.youtube-nocookie.com/embed'
    return `${base}?${params.toString()}`
  }

  if (loop) {
    // A single video will not loop on `loop=1` alone — the API requires the playlist to name it.
    params.set('loop', '1')
    params.set('playlist', target.videoId)
  }
  return `https://www.youtube-nocookie.com/embed/${target.videoId}?${params.toString()}`
}

/** A short human label for the settings UI, so a saved value is recognisable. */
export function describeTarget(target: YouTubeTarget): string {
  return target.kind === 'playlist'
    ? `Playlist ${target.playlistId}${target.videoId ? ` (from ${target.videoId})` : ''}`
    : `Video ${target.videoId}`
}
