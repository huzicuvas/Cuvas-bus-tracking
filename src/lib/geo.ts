import type { RouteStop } from './types'

// Straight-line distance between two GPS points, in kilometres.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export type StopProgress = {
  prevIndex: number | null
  nextIndex: number | null
  nextDistanceKm: number | null
  atStop: boolean
}

// Within this distance of a stop, the bus counts as "at" that stop.
const AT_STOP_KM = 0.15

// Work out previous / next stop from the bus's live position and the
// route's ordered stop list. Only stops saved with coordinates can be
// located; stops without them are skipped for the calculation but keep
// their place in the list (indices refer to the full list).
export function computeStopProgress(
  busLat: number | null,
  busLng: number | null,
  stops: RouteStop[],
): StopProgress {
  const empty: StopProgress = {
    prevIndex: null,
    nextIndex: null,
    nextDistanceKm: null,
    atStop: false,
  }
  if (busLat == null || busLng == null || stops.length === 0) return empty

  // Plain for loop (not forEach): TypeScript only narrows `best` correctly
  // when the assignment happens in the same function scope.
  let best: { index: number; dist: number } | null = null
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    if (s.lat == null || s.lng == null) continue
    const d = haversineKm(busLat, busLng, s.lat, s.lng)
    if (best == null || d < best.dist) best = { index: i, dist: d }
  }
  if (best == null) return empty

  const atStop = best.dist < AT_STOP_KM
  const nextIndex = atStop
    ? best.index + 1 < stops.length
      ? best.index + 1
      : null
    : best.index
  const prevIndex = atStop ? best.index : best.index - 1 >= 0 ? best.index - 1 : null

  let nextDistanceKm: number | null = null
  if (nextIndex != null) {
    const s = stops[nextIndex]
    if (s.lat != null && s.lng != null) {
      nextDistanceKm = haversineKm(busLat, busLng, s.lat, s.lng)
    }
  }
  return { prevIndex, nextIndex, nextDistanceKm, atStop }
}
