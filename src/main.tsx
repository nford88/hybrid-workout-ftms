import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppShell from './components/layout/AppShell'
import { TrainerProvider, RouteProvider, WorkoutProvider } from './context'
import * as virtualGear from './services/virtualGearState'

// The SIM pipeline still lives in the legacy IIFE (src/js/main.js), which is loaded after
// mount and cannot import ES modules. Publishing the typed drivetrain here — rather than
// reimplementing it there — keeps the model in one place: main.js only calls sendGradeFor().
;(window as unknown as { virtualDrivetrain: typeof virtualGear }).virtualDrivetrain = virtualGear

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
