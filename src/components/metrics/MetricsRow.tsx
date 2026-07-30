import { useState, useEffect } from 'react'
import MetricCard from './MetricCard'
import { useTrainer, useWorkout, useRoute } from '../../context'
import { getGradeForDistance } from '../../services/routeService'
import { formatTime } from '../../utils/time'
import { subscribeVirtualGear, type VirtualGearSnapshot } from '../../services/virtualGearState'
import { ZWIFT_GEAR_RATIOS } from '../../services/virtualDrivetrain'

export default function MetricsRow() {
  const { isConnected, liveData } = useTrainer()
  const { isRunning, workoutStartTime, simDistanceTraveled, currentStepIndex } = useWorkout()
  const { workoutPlan, preprocessedRoute } = useRoute()
  const [elapsed, setElapsed] = useState(0)
  const [gear, setGear] = useState<VirtualGearSnapshot | null>(null)

  useEffect(() => subscribeVirtualGear(setGear), [])

  useEffect(() => {
    if (!isRunning) {
      setElapsed(0) // eslint-disable-line react-hooks/set-state-in-effect
      return
    }
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - workoutStartTime!) / 1000)),
      1000
    )
    return () => clearInterval(id)
  }, [isRunning, workoutStartTime])

  const currentStep = workoutPlan[currentStepIndex]

  let gradientValue = '—'
  let gradientColor = 'text-gray-300'
  if (isRunning && currentStep?.type === 'sim' && preprocessedRoute.length > 0) {
    const grade = getGradeForDistance(simDistanceTraveled || 0, preprocessedRoute)
    if (Number.isFinite(grade)) {
      gradientValue = `${grade > 0 ? '+' : ''}${grade.toFixed(1)}`
      gradientColor = grade > 0 ? 'text-red-400' : grade < 0 ? 'text-blue-400' : 'text-green-400'
    }
  }

  const dash = '—'
  const power = isConnected ? String(liveData.power) : dash

  // Under virtual shifting the speed that matters is the VIRTUAL one — the trainer's own
  // figure reflects the grade we send it to fake resistance, not how fast the rider is
  // actually travelling. Falls back to the trainer's while coasting or when not shifting.
  const virtualKph = gear?.last && !gear.last.coasting ? gear.last.virtualSpeedMs * 3.6 : null
  const speed = isConnected ? (virtualKph ?? liveData.speed).toFixed(1) : dash
  const cadence = isConnected ? String(Math.round(liveData.cadence)) : dash
  const time = isRunning ? formatTime(elapsed) : dash

  // Gear turns amber at the top of the range, where the model wants more than the ±25%
  // grade clamp can deliver — the rider is getting less resistance than the gear implies.
  const gearValue = gear ? `${gear.gearIndex + 1}` : dash
  const gearUnit = gear ? `of ${ZWIFT_GEAR_RATIOS.length} · ${gear.gearRatio.toFixed(2)}` : 'ratio'
  const gearColor = gear?.last?.clamped ? 'text-amber-400' : 'text-orange-400'

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 sm:gap-3 md:gap-4 mb-4 sm:mb-6">
      <MetricCard label="Power" unit="watts" color="text-cyan-400" value={power} />
      <MetricCard
        label="Speed"
        unit={virtualKph !== null ? 'kph (virtual)' : 'kph'}
        color="text-green-400"
        value={speed}
      />
      <MetricCard label="Cadence" unit="rpm" color="text-yellow-400" value={cadence} />
      <MetricCard label="Gear" unit={gearUnit} color={gearColor} value={gearValue} />
      <MetricCard label="Time" unit="mm:ss" color="text-purple-400" value={time} />
      <MetricCard label="Gradient" unit="%" color={gradientColor} value={gradientValue} />
    </div>
  )
}
