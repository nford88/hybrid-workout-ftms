export default function RouteImport() {
  return (
    <div className="section-card">
      <h2 className="section-title">Import Garmin Route</h2>

      <div id="route-input-container">
        <textarea
          id="garmin-data"
          className="form-textarea"
          placeholder="Paste your Garmin route JSON here..."
        />
        <button id="save-route-button" className="btn-import mt-3 sm:mt-4">
          Import Route
        </button>
      </div>

      <div id="route-info" className="hidden">
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 sm:p-4">
          <h3 className="text-base sm:text-lg font-semibold text-green-400 mb-2">
            Route Loaded: <span id="segment-name" />
          </h3>
          <p className="text-sm sm:text-base text-green-300">
            <strong>Distance:</strong> <span id="total-distance" />
            <br />
            <strong>Average Grade:</strong> <span id="average-grade" />
          </p>
        </div>
      </div>
    </div>
  )
}
