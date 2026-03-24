import RouteImport from '../route/RouteImport'
import WorkoutBuilder from '../workout/WorkoutBuilder'
import WorkoutPlan from '../workout/WorkoutPlan'
import SavedWorkouts from '../workout/SavedWorkouts'
import VirtualGearSettings from '../virtual/VirtualGearSettings'

export default function SetupView() {
  return (
    <div>
      <RouteImport />

      <div className="section-card">
        <h2 className="section-title">Build Workout</h2>
        <WorkoutBuilder />
        <button id="add-step-button" className="btn-add">
          Add Step
        </button>
        <SavedWorkouts />
        <VirtualGearSettings />
        <WorkoutPlan />
      </div>
    </div>
  )
}
