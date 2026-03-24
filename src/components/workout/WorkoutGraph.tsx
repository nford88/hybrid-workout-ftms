export default function WorkoutGraph() {
  return (
    <div
      id="workout-graph-container"
      className="w-full bg-surface rounded-lg border border-border mb-4 overflow-hidden"
    >
      <svg
        id="workout-graph"
        className="w-full"
        viewBox="0 0 800 150"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x="0" y="0" width="800" height="150" fill="#1a1d27" />

        <line
          id="graph-zero-line"
          x1="50"
          y1="75"
          x2="750"
          y2="75"
          stroke="#374151"
          strokeWidth="1"
          strokeDasharray="4"
        />

        <g id="graph-y-labels-left" fill="#60a5fa" fontSize="9">
          <text x="45" y="20" textAnchor="end" fontWeight="bold">
            W
          </text>
          <text x="45" y="35" textAnchor="end">
            —
          </text>
          <text x="45" y="140" textAnchor="end">
            0
          </text>
        </g>

        <g id="graph-y-labels-right" fill="#fb923c" fontSize="9">
          <text x="755" y="20" textAnchor="start" fontWeight="bold">
            %
          </text>
          <text x="755" y="35" textAnchor="start">
            +15
          </text>
          <text x="755" y="78" textAnchor="start">
            0
          </text>
          <text x="755" y="140" textAnchor="start">
            -10
          </text>
        </g>

        <g id="graph-erg-profiles" />
        <g id="graph-sim-profiles" />
        <g id="graph-step-dividers" />

        <g id="graph-position-marker" transform="translate(50, 0)">
          <line x1="0" y1="5" x2="0" y2="145" stroke="#ef4444" strokeWidth="2.5" />
          <polygon points="-6,5 6,5 0,15" fill="#ef4444" />
        </g>

        <defs>
          <linearGradient id="erg-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#3b82f6', stopOpacity: 0.7 }} />
            <stop offset="100%" style={{ stopColor: '#3b82f6', stopOpacity: 0.2 }} />
          </linearGradient>
          <linearGradient id="sim-gradient-up" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#f97316', stopOpacity: 0.7 }} />
            <stop offset="100%" style={{ stopColor: '#f97316', stopOpacity: 0.2 }} />
          </linearGradient>
          <linearGradient id="sim-gradient-down" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" style={{ stopColor: '#22c55e', stopOpacity: 0.7 }} />
            <stop offset="100%" style={{ stopColor: '#22c55e', stopOpacity: 0.2 }} />
          </linearGradient>
        </defs>

        <text
          id="graph-empty-message"
          x="400"
          y="80"
          textAnchor="middle"
          fill="#4b5563"
          fontSize="14"
        >
          Add workout steps to see profile
        </text>
      </svg>

      <div className="flex justify-center gap-4 py-1 text-xs text-gray-500 border-t border-border">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-blue-500 opacity-70" /> ERG Power
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-orange-500 opacity-70" /> SIM Gradient
        </span>
      </div>
    </div>
  )
}
