import { describe, test, expect } from 'vitest'
import { haversineDistance } from '../../src/utils/geo'
import { clamp } from '../../src/utils/math'
import { formatTime } from '../../src/utils/time'

// ── haversineDistance ────────────────────────────────────────────────────────

describe('haversineDistance', () => {
  test('returns 0 for identical points', () => {
    expect(haversineDistance(51.5, -0.1, 51.5, -0.1)).toBe(0)
  })

  test('returns positive distance for distinct points', () => {
    const d = haversineDistance(51.5, -0.1, 51.51, -0.1)
    expect(d).toBeGreaterThan(0)
  })

  test('known distance: London to Paris ≈ 340 km', () => {
    const d = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522)
    expect(d).toBeGreaterThan(330_000)
    expect(d).toBeLessThan(350_000)
  })

  test('is symmetric — swapping points gives same result', () => {
    const d1 = haversineDistance(40.7128, -74.006, 51.5074, -0.1278)
    const d2 = haversineDistance(51.5074, -0.1278, 40.7128, -74.006)
    expect(d1).toBeCloseTo(d2, 5)
  })

  test('short segment (~100 m) is accurate', () => {
    // Roughly 0.001° lat ≈ 111 m
    const d = haversineDistance(51.0, 0.0, 51.001, 0.0)
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(120)
  })

  test('handles crossing the equator', () => {
    const d = haversineDistance(-1.0, 0.0, 1.0, 0.0)
    expect(d).toBeGreaterThan(200_000)
    expect(d).toBeLessThan(230_000)
  })
})

// ── clamp ────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  test('clamps to lo when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  test('clamps to hi when value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  test('returns lo when value equals lo', () => {
    expect(clamp(0, 0, 10)).toBe(0)
  })

  test('returns hi when value equals hi', () => {
    expect(clamp(10, 0, 10)).toBe(10)
  })

  test('works with negative ranges', () => {
    expect(clamp(-15, -10, -5)).toBe(-10)
    expect(clamp(-7, -10, -5)).toBe(-7)
    expect(clamp(-3, -10, -5)).toBe(-5)
  })

  test('works with floats', () => {
    expect(clamp(1.75, 0, 1.5)).toBeCloseTo(1.5)
    expect(clamp(0.5, 0.3, 0.8)).toBeCloseTo(0.5)
  })
})

// ── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  test('formats 0 seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00')
  })

  test('formats seconds below 60', () => {
    expect(formatTime(5)).toBe('00:05')
    expect(formatTime(59)).toBe('00:59')
  })

  test('formats exactly 1 minute', () => {
    expect(formatTime(60)).toBe('01:00')
  })

  test('formats minutes and seconds', () => {
    expect(formatTime(90)).toBe('01:30')
    expect(formatTime(3661)).toBe('61:01')
  })

  test('zero-pads both minutes and seconds', () => {
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(600)).toBe('10:00')
  })

  test('handles large durations', () => {
    // 2h workout = 7200s
    expect(formatTime(7200)).toBe('120:00')
  })
})
