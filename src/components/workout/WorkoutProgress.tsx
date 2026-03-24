import { useState, useEffect } from 'react'
import { useTrainer, useWorkout, useRoute } from '../../context'
import { calculateErgProgress } from '../../services/workoutService'
import WorkoutGraph from './WorkoutGraph'

export default function WorkoutProgress() {
  const { liveData } = useTrainer()
  const {
    isRunning,
    currentStepIndex,
    stepStartTime,
    simDistanceTraveled,
    stepSimDistance,
    routeCompleted,
  } = useWorkout()
  const { workoutPlan, route } = useRoute()
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const currentStep = workoutPlan[currentStepIndex]

  // Progress bar
  let progressPct = 0
  if (isRunning && currentStep) {
    if (currentStep.type === 'erg' && currentStep.duration) {
      progressPct = calculateErgProgress(stepStartTime!, currentStep.duration, now)
    } else if (currentStep.type === 'sim' && route && route.totalDistance > 0) {
      progressPct = Math.min(100, ((simDistanceTraveled || 0) / route.totalDistance) * 100)
    }
  }

  // Step distance
  let stepDistanceText = '—'
  if (isRunning && currentStep) {
    if (currentStep.type === 'sim') {
      const routeDistance = Math.round(simDistanceTraveled || 0)
      if (route && routeCompleted) {
        const extra = Math.round((stepSimDistance || 0) - route.totalDistance)
        stepDistanceText = `${route.totalDistance.toFixed(0)}+${extra}m`
      } else if (route && route.totalDistance > 0) {
        const pct = ((routeDistance / route.totalDistance) * 100).toFixed(0)
        stepDistanceText = `${routeDistance}m (${pct}%)`
      } else {
        stepDistanceText = `${routeDistance}m`
      }
    } else if (currentStep.type === 'erg') {
      const stepElapsedSec = (now - stepStartTime!) / 1000
      const dist = Math.round((liveData.speed / 3.6) * stepElapsedSec)
      stepDistanceText = `${dist}m`
    }
  }

  return (
    <div className="section-card">
      <h2 className="section-title">Workout Progress</h2>

      <div className="mb-4">
        <div
          id="workout-progress-text"
          className="text-base sm:text-lg font-medium text-gray-300 mb-3"
        >
          Ready to start workout
        </div>

        <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
          <div
            className="bg-cyan-500 h-2 rounded-full transition-all duration-1000"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <WorkoutGraph />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-surface-elevated rounded-lg p-3 sm:p-4">
          <h3 className="text-xs sm:text-sm font-semibold text-gray-400 mb-1">Current Target</h3>
          <div id="target-display" className="text-lg sm:text-xl font-bold text-white">
            —
          </div>
        </div>

        <div className="bg-surface-elevated rounded-lg p-3 sm:p-4">
          <h3 className="text-xs sm:text-sm font-semibold text-gray-400 mb-1">Step Distance</h3>
          <div className="text-lg sm:text-xl font-bold text-white">{stepDistanceText}</div>
        </div>
      </div>
    </div>
  )
}
