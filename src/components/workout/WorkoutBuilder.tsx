export default function WorkoutBuilder() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4">
      <div>
        <label className="form-label">Step Type</label>
        <select id="step-type" className="form-select">
          <option value="erg">ERG (Fixed Power)</option>
          <option value="sim" disabled>
            SIM (Route Gradient)
          </option>
        </select>
      </div>

      <div id="erg-inputs">
        <label className="form-label">Duration (minutes)</label>
        <input
          type="number"
          id="erg-duration"
          className="form-input"
          min="1"
          placeholder="e.g., 20"
        />
      </div>

      <div id="erg-inputs">
        <label className="form-label">Power (watts)</label>
        <input
          type="number"
          id="erg-power"
          className="form-input"
          min="50"
          max="500"
          placeholder="e.g., 250"
        />
      </div>

      <div id="sim-inputs" className="hidden">
        <label className="form-label">Route Segment</label>
        <select id="sim-segment" className="form-select">
          <option>No route loaded</option>
        </select>
      </div>
    </div>
  )
}
