import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppShell from './components/layout/AppShell'
import { TrainerProvider, RouteProvider, WorkoutProvider } from './context'
import * as virtualGear from './services/virtualGearState'
import * as rideLog from './services/rideLog'

// The SIM pipeline still lives in the legacy IIFE (src/js/main.js), which is loaded after
// mount and cannot import ES modules. Publishing the typed drivetrain here — rather than
// reimplementing it there — keeps the model in one place: main.js only calls sendGradeFor().
;(window as unknown as { virtualDrivetrain: typeof virtualGear }).virtualDrivetrain = virtualGear
// The ride log is the only record of sent grade, gear and target power — a head unit cannot
// capture them. Exposed on window so it can be exported from the console mid-ride too.
;(window as unknown as { rideLog: typeof rideLog }).rideLog = rideLog

declare const __BUILD_HASH__: string | undefined
declare const __BUILD_TIME__: string | undefined

// Build version logging
const version = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'
const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'local'
console.log(
  `%c🚴 FTMS Hybrid Workout | Build: ${version} | ${buildTime}`,
  'color: #06b6d4; font-weight: bold;'
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrainerProvider>
      <RouteProvider>
        <WorkoutProvider>
          <AppShell buildVersion={version} />
        </WorkoutProvider>
      </RouteProvider>
    </TrainerProvider>
  </StrictMode>
)
