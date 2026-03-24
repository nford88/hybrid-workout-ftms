import { haversineDistance } from '../utils/geo.js'
import type { GeoPoint, RouteDataPoint } from '../types.js'

/**
 * Convert raw geoPoints array into a preprocessed route array with cumulative
 * distances and grade percentages.
 */
export function preprocessRouteData(geoPoints: GeoPoint[]): RouteDataPoint[] {
  const out: RouteDataPoint[] = []
  let total = 0
  if (geoPoints.length) out.push({ distance: 0, elevation: geoPoints[0].elevation, grade: 0 })
  for (let i = 0; i < geoPoints.length - 1; i++) {
    const p1 = geoPoints[i],
      p2 = geoPoints[i + 1]
    const seg = haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
    total += seg
    const elevΔ = p2.elevation - p1.elevation
    const grade = seg > 0 ? (elevΔ / seg) * 100 : 0
    out.push({ distance: total, elevation: p2.elevation, grade })
  }
  return out
}

/**
 * Look up the grade (%) at a given distance along a preprocessed route.
 */
export function getGradeForDistance(distance: number, routeData: RouteDataPoint[]): number {
  const arr = routeData
  if (!arr || !arr.length) return 0
  if (distance <= 0) return arr[0].grade
  if (distance >= arr[arr.length - 1].distance) return arr[arr.length - 1].grade
  for (let i = 0; i < arr.length - 1; i++) {
    if (distance >= arr[i].distance && distance < arr[i + 1].distance) return arr[i + 1].grade
  }
  return 0
}
