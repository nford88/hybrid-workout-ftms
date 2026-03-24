export default function WorkoutPlan() {
  return (
    <div className="mt-4 sm:mt-6">
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-white">Workout Plan</h3>
        <button id="clear-workout-button" className="hidden btn-danger">
          Clear All
        </button>
      </div>

      <div id="no-steps" className="text-sm sm:text-base text-gray-500 italic">
        No steps added yet. Add your first workout step above.
      </div>
      <div id="workout-list" className="space-y-2 sm:space-y-3" />
    </div>
  )
}
