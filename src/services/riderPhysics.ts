import type { RiderPhysicsSettings } from '../types.js'

// Zwift's own pinned SIM-mode constants, confirmed byte-level from the Zwift Hub
// protocol's own .proto file comments (docs/virtual-shifting/PROTOCOLS.md §2.0) and
// corroborated by an independent open-source reference (Kickr-Virtual-Shifting:
// Crr=0.00415, Cw=0.51). Used as the zero-surprise default preset.
export const ZWIFT_CRR = 0.004
export const ZWIFT_CW = 0.51

export const DEFAULT_RIDER_WEIGHT_KG = 75
export const DEFAULT_BIKE_WEIGHT_KG = 8

export interface TirePreset {
  id: string
  label: string
  crr: number
}

export interface PositionPreset {
  id: string
  label: string
  cw: number
}

// Presets derived from docs/virtual-shifting/experiments/10-offline-fit-physics-
// analysis.md (this rider's own fitted Crr average, mass fixed at a known weight,
// converged to 0.0152-0.0200) and general road-cycling aerodynamics literature.
export const TIRE_CRR_PRESETS: TirePreset[] = [
  { id: 'trainer-smooth', label: 'Smooth trainer/indoor tire', crr: ZWIFT_CRR },
  { id: 'road-slick', label: 'Racing slick, smooth road', crr: 0.005 },
  { id: 'road-average', label: 'Standard road tire, average pavement', crr: 0.011 },
  { id: 'road-worn', label: 'Worn/rough road tire (this rider’s fitted avg)', crr: 0.017 },
  { id: 'gravel', label: 'Gravel / knobby tire', crr: 0.02 },
]

export const POSITION_CW_PRESETS: PositionPreset[] = [
  { id: 'aero-bars', label: 'Aero bars / TT position', cw: 0.2 },
  { id: 'drops', label: 'Drops, aggressive', cw: 0.28 },
  { id: 'hoods', label: 'Hoods, normal', cw: 0.36 },
  { id: 'upright', label: 'Upright / tops', cw: 0.45 },
  { id: 'trainer-default', label: 'HW-V8 trainer default', cw: ZWIFT_CW },
]

/** Resolve a rider's tire/position preset selections into Crr/Cw for FTMS setSim.
 * Falls back to Zwift's own pinned constants for unset or unrecognized preset ids. */
export function resolvePhysicsConstants(settings: RiderPhysicsSettings): {
  crr: number
  cw: number
} {
  const tire = TIRE_CRR_PRESETS.find((p) => p.id === settings.tireType)
  const position = POSITION_CW_PRESETS.find((p) => p.id === settings.ridingPosition)
  return {
    crr: tire ? tire.crr : ZWIFT_CRR,
    cw: position ? position.cw : ZWIFT_CW,
  }
}
