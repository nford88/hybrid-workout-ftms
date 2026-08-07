import { describe, test, expect } from 'vitest'
import { preprocessRouteData, getGradeForDistance } from '../../src/services/routeService'
import route from '../../docs/virtual-shifting/experiments/hairpin-6km-route.json'

/**
 * "Rolling Hairpins 6km" exists because "Leap Lane Hills" cannot test shifting. It reaches
 * 22.7%, and the rider's mapping is that anything past ~5% pins them in gear 1 — so a route
 * that lives above 6% offers no gear to choose and measures nothing.
 *
 * This route is built backwards from that mapping:
 *
 *     flat or downhill   -> above gear 12
 *     1-3%               -> gear 8-12
 *     4-5%               -> gear 4-7
 *     more than ~5%      -> gear 1
 *
 * These tests pin the properties that make it useful, through the real route pipeline rather
 * than the generator's own arithmetic. If someone regenerates it with different anchors and
 * pushes it out of the productive band, this fails.
 */
describe('Rolling Hairpins 6km — the shifting test route', () => {
  const points = preprocessRouteData(route.geoPoints)
  // The first entry is a synthetic distance-0 anchor with grade 0; the rest carry real grades.
  const graded = points.slice(1)

  test('parses through the real pipeline and covers 6 km', () => {
    expect(route.name).toBe('Rolling Hairpins 6km')
    expect(points.length).toBeGreaterThan(100)
    expect(points[points.length - 1].distance).toBeCloseTo(6000, 0)
  })

  test('stays inside the productive band: never above 6%, never below -4%', () => {
    const max = Math.max(...graded.map((p) => p.grade))
    const min = Math.min(...graded.map((p) => p.grade))
    expect(max).toBeLessThanOrEqual(6.0)
    expect(min).toBeGreaterThanOrEqual(-4.0)
    // And it must actually USE the band — a flat route would pass the bounds trivially.
    expect(max).toBeGreaterThan(5.0)
    expect(min).toBeLessThan(-2.5)
  })

  test('visits every gear band with a meaningful stretch of road', () => {
    const band = { top: 0, gentle: 0, moderate: 0, steep: 0 }
    for (let i = 1; i < points.length; i++) {
      const seg = points[i].distance - points[i - 1].distance
      const g = points[i].grade
      if (g < 1.0)
        band.top += seg // descent + flat -> gear 12+
      else if (g < 3.5)
        band.gentle += seg // -> gear 8-12
      else if (g <= 5.0)
        band.moderate += seg // -> gear 4-7
      else band.steep += seg // -> gear 1-3
    }
    // Every band gets at least 500 m, so no gear range goes untested.
    expect(band.top).toBeGreaterThan(1000)
    expect(band.gentle).toBeGreaterThan(1000)
    expect(band.moderate).toBeGreaterThan(500)
    expect(band.steep).toBeGreaterThan(100)
  })

  test('no segment outruns the 1.5%-per-10m smoothing ramp', () => {
    // calculateRealisticGrade clamps to MAX_GRADE_CHANGE_PER_RAMP per 10 m. A step change
    // outstrips it and the smoothed grade lags metres behind the road — half of why the old
    // route's telemetry read strangely. Linear anchors keep each 50 m segment gentle.
    for (let i = 2; i < points.length; i++) {
      const delta = Math.abs(points[i].grade - points[i - 1].grade)
      expect(delta).toBeLessThan(1.5)
    }
  })

  test('has real hairpins — at least three eases of 3% or more', () => {
    // A hairpin apex is a sharp drop in gradient followed by it building again. That swing is
    // what forces a rider up and down the block instead of settling into one gear.
    let eases = 0
    const WINDOW = 4 // 4 x 50 m = 200 m, about one apex
    for (let i = WINDOW; i < points.length; i++) {
      if (points[i - WINDOW].grade - points[i].grade >= 3.0) {
        eases += 1
        i += WINDOW // do not double-count the same apex
      }
    }
    expect(eases).toBeGreaterThanOrEqual(3)
  })

  test('grade lookup is stable across the whole route', () => {
    for (let d = 0; d <= 6000; d += 100) {
      const g = getGradeForDistance(d, points)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeLessThanOrEqual(6.0)
      expect(g).toBeGreaterThanOrEqual(-4.0)
    }
  })
})
