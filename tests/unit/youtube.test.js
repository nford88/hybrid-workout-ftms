import { describe, test, expect } from 'vitest'
import { parseYouTubeTarget, buildEmbedUrl, describeTarget } from '../../src/services/youtube'

/**
 * The input here is "whatever the rider copied out of the address bar". A wrong parse becomes an
 * empty player mid-ride with nothing to explain it, so unrecognised input must return null rather
 * than a guess.
 */

describe('parsing what the user pasted', () => {
  test('a plain watch URL', () => {
    expect(parseYouTubeTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  test('a youtu.be short link', () => {
    expect(parseYouTubeTarget('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  test('an embed URL, and a shorts URL', () => {
    expect(parseYouTubeTarget('https://www.youtube.com/embed/dQw4w9WgXcQ')?.videoId).toBe(
      'dQw4w9WgXcQ'
    )
    expect(parseYouTubeTarget('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.videoId).toBe(
      'dQw4w9WgXcQ'
    )
  })

  test('a playlist URL', () => {
    expect(parseYouTubeTarget('https://www.youtube.com/playlist?list=PLabcdefghij12')).toEqual({
      kind: 'playlist',
      playlistId: 'PLabcdefghij12',
      videoId: null,
    })
  })

  test('watch?v=…&list=… is a PLAYLIST starting at that video, not a single video', () => {
    // Treating this as one video would silently drop the rest of the list — the whole point of
    // pasting it was the list.
    expect(
      parseYouTubeTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij12')
    ).toEqual({ kind: 'playlist', playlistId: 'PLabcdefghij12', videoId: 'dQw4w9WgXcQ' })
  })

  test('bare IDs, told apart by shape', () => {
    // 11 chars exactly = video. Prefixed and longer = playlist.
    expect(parseYouTubeTarget('dQw4w9WgXcQ')).toEqual({ kind: 'video', videoId: 'dQw4w9WgXcQ' })
    expect(parseYouTubeTarget('PLabcdefghij12')).toEqual({
      kind: 'playlist',
      playlistId: 'PLabcdefghij12',
      videoId: null,
    })
  })

  test('channel-uploads and auto-generated playlist prefixes are accepted', () => {
    for (const id of ['UUabcdefghij12', 'OLAK5uy_abcdefghij', 'RDabcdefghij12']) {
      expect(parseYouTubeTarget(id)?.kind).toBe('playlist')
    }
  })

  test('a URL without a scheme still parses', () => {
    expect(parseYouTubeTarget('youtube.com/watch?v=dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ')
  })

  test('surrounding whitespace is tolerated', () => {
    expect(parseYouTubeTarget('  https://youtu.be/dQw4w9WgXcQ \n')?.videoId).toBe('dQw4w9WgXcQ')
  })

  test('a lookalike host is REJECTED, not substring-matched', () => {
    // `youtube.com.evil.test` contains "youtube.com". An allow-list is the only safe check.
    expect(parseYouTubeTarget('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYouTubeTarget('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  test('garbage returns null rather than a guess', () => {
    for (const bad of ['', '   ', 'hello world', 'https://vimeo.com/12345', 'not a url at all']) {
      expect(parseYouTubeTarget(bad)).toBeNull()
    }
  })

  test('a wrong-length video id is not silently accepted', () => {
    expect(parseYouTubeTarget('https://www.youtube.com/watch?v=tooshort')).toBeNull()
    expect(parseYouTubeTarget('https://www.youtube.com/watch?v=waaaaaaaaytoolong')).toBeNull()
  })
})

describe('building the embed URL', () => {
  const video = { kind: 'video', videoId: 'dQw4w9WgXcQ' }
  const playlist = { kind: 'playlist', playlistId: 'PLabcdefghij12', videoId: null }

  test('uses the no-cookie host — a trainer app has no business setting tracking cookies', () => {
    expect(buildEmbedUrl(video)).toContain('https://www.youtube-nocookie.com/embed/')
  })

  test('native fullscreen is disabled, because cinema mode is ours', () => {
    // YouTube's own fullscreen would cover the HUD, defeating the point of one screen.
    expect(buildEmbedUrl(video)).toContain('fs=0')
  })

  test('the JS API is enabled so the Click can drive playback', () => {
    expect(buildEmbedUrl(video)).toContain('enablejsapi=1')
  })

  test('autoplay is paired with mute, since no browser allows unmuted autoplay', () => {
    const url = buildEmbedUrl(video, { autoplay: true, muted: true })
    expect(url).toContain('autoplay=1')
    expect(url).toContain('mute=1')
  })

  test('unmuted is expressible, for after a user gesture has unlocked audio', () => {
    expect(buildEmbedUrl(video, { muted: false })).toContain('mute=0')
  })

  test('a playlist target sets listType and list', () => {
    const url = buildEmbedUrl(playlist)
    expect(url).toContain('listType=playlist')
    expect(url).toContain('list=PLabcdefghij12')
  })

  test('a playlist with a starting video embeds that video', () => {
    const url = buildEmbedUrl({ ...playlist, videoId: 'dQw4w9WgXcQ' })
    expect(url).toContain('/embed/dQw4w9WgXcQ')
    expect(url).toContain('list=PLabcdefghij12')
  })

  test('looping a single video needs it named in `playlist`, not just loop=1', () => {
    // A documented YouTube quirk: loop=1 alone does nothing for a single video.
    const url = buildEmbedUrl(video, { loop: true })
    expect(url).toContain('loop=1')
    expect(url).toContain('playlist=dQw4w9WgXcQ')
  })

  test('loop can be turned off', () => {
    expect(buildEmbedUrl(video, { loop: false })).not.toContain('loop=1')
  })

  test('a parsed target round-trips into a usable embed URL', () => {
    const t = parseYouTubeTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij12')
    const url = buildEmbedUrl(t)
    expect(url).toContain('/embed/dQw4w9WgXcQ')
    expect(url).toContain('list=PLabcdefghij12')
  })
})

describe('describeTarget', () => {
  test('names both shapes recognisably for the settings UI', () => {
    expect(describeTarget({ kind: 'video', videoId: 'dQw4w9WgXcQ' })).toBe('Video dQw4w9WgXcQ')
    expect(describeTarget({ kind: 'playlist', playlistId: 'PLabcdefghij12', videoId: null })).toBe(
      'Playlist PLabcdefghij12'
    )
    expect(
      describeTarget({ kind: 'playlist', playlistId: 'PLabcdefghij12', videoId: 'dQw4w9WgXcQ' })
    ).toContain('from dQw4w9WgXcQ')
  })
})
