// ─── Route ────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  latitude: number
  longitude: number
  elevation: number
  distance?: number
  timestamp?: number
}

export interface GarminRoute {
  name: string
  geoPoints: GeoPoint[]
  totalDistance: number
  averageGrade?: number
}

export interface RouteDataPoint {
  distance: number // cumulative metres
  elevation: number // metres
  grade: number // percentage
}

// ─── Workout plan ─────────────────────────────────────────────────────────────

export interface ErgStep {
  type: 'erg'
  duration: number // minutes
  power: number // watts
}

export interface SimStep {
  type: 'sim'
  segmentName: string
}

export type WorkoutStep = ErgStep | SimStep

// ─── Workout runtime state ────────────────────────────────────────────────────

export interface WorkoutState {
  stepStartTime: number
  stepSimDistance: number
  simDistanceTraveled: number
  routeCompleted: boolean
  currentGrade?: number
  targetGrade?: number
  lastGradeUpdate?: number
  lastGradeDistance?: number
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export interface StepSummary {
  stepNumber: number
  type: 'erg' | 'sim'
  plannedDuration: number | null
  actualDuration: number
  distance: number
  averageSpeed: number
  target: string
  segmentName: string | null
  routeDistance: number | null
  routeCompleted: boolean | null
}

export interface WorkoutSummary {
  totalTime: number
  totalDistance: number
  averageSpeed: number
  steps: StepSummary[]
  timestamp: number
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface SavedWorkoutEntry {
  name: string
  plan: WorkoutStep[]
  routeName: string | null
  savedAt: number
}

export interface GearSettings {
  ftp: number | null
  baselineGear: number | null
}

// ─── Graph ────────────────────────────────────────────────────────────────────

export interface GraphConfig {
  width: number
  height: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
  minPower: number
  maxPower: number
  minGrade: number
  maxGrade: number
}

export interface GraphErgStep {
  type: 'erg'
  power: number
  startTime: number
  endTime: number
  duration: number
}

export interface GraphSimStep {
  type: 'sim'
  startTime: number
  endTime: number
  duration: number
  segmentName: string
  routeDistance: number
}

export type GraphStep = GraphErgStep | GraphSimStep

export interface WorkoutMetrics {
  totalDuration: number
  steps: GraphStep[]
  maxPower: number
}

// ─── Trainer / live data ──────────────────────────────────────────────────────

export interface LiveData {
  power: number
  speed: number
  cadence: number
}
