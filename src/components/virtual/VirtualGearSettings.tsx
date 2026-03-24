export default function VirtualGearSettings() {
  return (
    <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-blue-950/40 rounded-lg border border-blue-800/50">
      <h3 className="text-sm sm:text-base font-semibold text-blue-300 mb-3">
        Virtual Gearing (SIM Mode)
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="form-label text-xs">FTP (Functional Threshold Power)</label>
          <input
            type="number"
            id="ftp-input"
            className="form-input text-sm"
            min="100"
            max="500"
            placeholder="e.g., 220"
            defaultValue="220"
          />
          <p className="text-xs text-gray-500 mt-1">Calibration v1: 220W</p>
        </div>

        <div>
          <label className="form-label text-xs">Baseline Physical Gear</label>
          <select id="baseline-gear-select" className="form-select text-sm" defaultValue="5">
            <option value="5">34/17 (Calibration baseline ✓)</option>
            <option value="3">34/21 (Alternative baseline)</option>
            <option value="16">50/17 (Harder baseline)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">⚠️ Must match calibration (34/17 required)</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          id="apply-ftp-button"
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply Settings
        </button>
        <a
          href="dev/power-curve-calibration.html"
          target="_blank"
          className="px-3 py-2 text-sm bg-purple-700 text-white rounded-lg hover:bg-purple-600 transition-colors text-center"
        >
          🧪 Calibrate Power Curve
        </a>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        <span id="power-curve-status">Using generic FTP-based model</span>
        {' | '}
        <span className="text-blue-400">Use ← → or [ ] to shift during workouts</span>
      </p>
    </div>
  )
}
