export default function SavedWorkouts() {
  return (
    <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-surface-elevated rounded-lg border border-border">
      <h3 className="text-sm sm:text-base font-semibold text-gray-300 mb-3">Saved Workouts</h3>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex-1">
          <select id="saved-workouts-select" className="form-select text-sm">
            <option value="">— Select saved workout —</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            id="load-workout-button"
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled
          >
            Load
          </button>
          <button
            id="delete-saved-workout-button"
            className="px-3 py-2 text-sm bg-red-700 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-3 pt-3 border-t border-border">
        <div className="flex-1">
          <input
            type="text"
            id="save-workout-name"
            className="form-input text-sm"
            placeholder="Enter workout name..."
          />
        </div>
        <button
          id="save-workout-button"
          className="px-3 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          Save Current
        </button>
      </div>

      <p id="saved-workouts-count" className="text-xs text-gray-500 mt-2">
        No saved workouts
      </p>
    </div>
  )
}
